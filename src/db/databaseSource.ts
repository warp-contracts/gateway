import { Knex, knex } from 'knex';
import { SequencerInsert, InteractionInsert, ContractInsert, ContractSourceInsert } from './insertInterfaces';
import fs from 'fs';
import path from 'path';
import { client } from '../nodemailer/config';
import { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

interface DbData {
  client: 'pg';
  url: string;
  ssl?: { ca: string | Buffer; cert: string | Buffer; key: string | Buffer; rejectUnauthorized: boolean };
  options?: Partial<Knex.Config>;
}

export class DatabaseSource {
  public db: Knex[] = [];
  private primaryDb: Knex;
  private mailClient: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(dbData: DbData[], primaryDb?: number) {
    for (let i = 0; i < dbData.length; i++) {
      this.db[i] = this.connectDb(dbData[i]);
    }
    this.primaryDb = primaryDb ? this.db[primaryDb] : this.db[0];
    this.mailClient = client();
  }

  public async insertSequencer(sequencerInsert: SequencerInsert, trx: Knex.Transaction) {
    await trx('sequencer').insert(sequencerInsert);
  }

  public async insertInteraction(interactionInsert: InteractionInsert, trx: Knex.Transaction) {
    await trx('interactions').insert(interactionInsert);
  }

  public async insertSequencerAndInteraction(
    sequencerInsert: SequencerInsert,
    interactionInsert: InteractionInsert,
    primaryDbTx: Knex.Transaction
  ): Promise<void> {
    try {
      await Promise.all([
        await this.insertSequencer(sequencerInsert, primaryDbTx),
        await this.insertInteraction(interactionInsert, primaryDbTx),
      ]);
      await primaryDbTx.commit();
    } catch (e: any) {
      await primaryDbTx.rollback();
      throw new Error(e);
    }

    if (this.db.length > 1) {
      const dbWithoutPrimary = this.filterPrimaryDb();
      for (let i = 0; i < dbWithoutPrimary.length; i++) {
        try {
          await this.loopDbAndHandleError(
            async (db: Knex, trx: Knex.Transaction) => {
              await Promise.all([
                await this.insertSequencer(sequencerInsert, trx),
                await this.insertInteraction(interactionInsert, trx),
              ]);
            },
            interactionInsert.interaction_id,
            dbWithoutPrimary[i],
            { trx: true }
          );
        } catch (e) {
          console.log(e);
        }
      }
    }
  }

  public async insertContract(contractInsert: ContractInsert) {
    await this.loopThroughDb(async (db: Knex) => {
      await db('contracts').insert(contractInsert);
    }, contractInsert.contract_id);
  }

  public async insertContractSource(contractSourceInsert: ContractSourceInsert) {
    await this.loopThroughDb(async (db: Knex) => {
      await db('contracts_src').insert(contractSourceInsert).onConflict('src_tx_id').ignore();
    }, contractSourceInsert.src_tx_id);
  }

  public raw(query: string, bindings: any, dbIndex?: number) {
    const db = dbIndex ? this.db[dbIndex] : this.primaryDb;
    return db.raw(query, bindings);
  }

  public async loopThroughDb(callback: any, id: string) {
    try {
      await callback(this.primaryDb);
    } catch (e: any) {
      throw new Error(e);
    }

    if (this.db.length > 1) {
      const dbWithoutPrimary = this.filterPrimaryDb();
      for (let i = 0; i < dbWithoutPrimary.length; i++) {
        await this.loopDbAndHandleError(callback, id, dbWithoutPrimary[i]);
      }
    }
  }

  private connectDb(dbData: DbData): Knex {
    const options = {
      client: dbData.client,
      connection: {
        connectionString: dbData.url,
        ...(dbData.ssl ? { ssl: dbData.ssl } : ''),
      },
      useNullAsDefault: true,
      pool: {
        min: 5,
        max: 30,
        createTimeoutMillis: 3000,
        acquireTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 100,
        propagateCreateError: false,
      },
      ...dbData.options,
    };
    return knex(options);
  }

  private currentLocalDateWithTime(): string {
    const tzoffset = new Date().getTimezoneOffset() * 60000;
    return new Date(Date.now() - tzoffset).toISOString().substring(0, 19);
  }

  private async loopDbAndHandleError(callback: any, id: string, db: Knex, options?: { trx: boolean }): Promise<void> {
    let transaction: Knex.Transaction | undefined;
    if (options?.trx) {
      transaction = await db?.transaction();
    }
    try {
      await callback(db, transaction, 1);
      await transaction?.commit();
    } catch (e) {
      await transaction?.rollback();
      let count = 0;
      const maxRetry = 2;
      while (true) {
        let transaction: Knex.Transaction | undefined;
        if (options?.trx) {
          transaction = await db?.transaction();
        }
        try {
          await callback(db, transaction);
          await transaction?.commit();
          break;
        } catch (e: any) {
          await transaction?.rollback();
          if (++count == maxRetry) {
            const dbErrorDir = 'db_error_log';
            if (!fs.existsSync(dbErrorDir)) {
              fs.mkdirSync(dbErrorDir);
            }
            fs.writeFileSync(path.join(dbErrorDir, `${this.currentLocalDateWithTime()}_${id}`), e.message);

            this.mailClient.sendMail({
              from: 'notifications@warp.cc',
              to: ['asia@warp.cc', 'ppe@warp.cc', 'jan@warp.cc'],
              subject: `Error from Warp Gateway database. Transaction id: ${id}`,
              text: `Error while inserting transaction: ${id}. Please refer to the 'db_error_log' directory. ${e.message}`,
            });
            break;
          }
        }
      }
    }
  }

  private filterPrimaryDb(): Knex[] {
    return this.db.filter((d) => d !== this.primaryDb);
  }
}
