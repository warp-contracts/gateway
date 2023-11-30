import { Knex } from "knex";
import { Benchmark, LoggerFactory } from "warp-contracts";
import { createHash } from "crypto";

export type SortKeyMutexResult = {
  lastSortKey: string | null,
  blockHeight: number,
  blockHash: string,
  blockTimestamp: number
}

export class PgAdvisoryLocks {

  private readonly logger = LoggerFactory.INST.create(PgAdvisoryLocks.name);

  async acquireSortKeyMutex(contractTxId: string, trx: Knex.Transaction): Promise<SortKeyMutexResult> {
    const lockFor = contractTxId;
    const lockId = this.strToKey(lockFor);
    this.logger.debug("Locking for", {
      lockFor,
      lockId
    });
    await this.doAcquireLock(lockId, trx);
    return await this.loadLastSortKey(contractTxId, trx);
  }

  async acquireArweaveHeightMutex(trx: Knex.Transaction): Promise<{ blockHeight: number, blockHash: string, blockTimestamp: string } | null | undefined> {
    const lockFor = "ArweaveHeight";
    const lockId = this.strToKey(lockFor);
    this.logger.debug("Locking for", {
      lockFor,
      lockId
    });
    const hasLock = await this.tryLock(lockId, trx);
    if (hasLock) {
      const result = await trx.raw(
        `
            SELECT finished_block_height    AS "blockHeight",
                   finished_block_hash      AS "blockHash",
                   finished_block_timestamp as "blockTimestamp",
                   additional_data          as "additionalData"
            FROM sync_state
            WHERE name = 'Arweave';`
      );
      if (result?.rows?.length !== 1) {
        return null;
      }

      return result.rows[0];
    } else {
      return undefined;
    }
  }

  private async tryLock(lockId: number[], trx: Knex.Transaction): Promise<boolean> {
    const benchmark = Benchmark.measure();
    await trx.raw(`SET LOCAL lock_timeout = '5s';`);
    const result = await trx.raw(
      `SELECT pg_try_advisory_xact_lock(?, ?);`, [lockId[0], lockId[1]]
    );
    const hasLock = result.rows[0]["pg_try_advisory_xact_lock"];
    this.logger.debug("Acquiring pg_try_advisory_xact_lock", benchmark.elapsed(), hasLock);

    return hasLock;
  }

  private async doAcquireLock(lockId: number[], trx: Knex.Transaction): Promise<void> {
    // https://stackoverflow.com/a/20963803
    await trx.raw(`SET LOCAL lock_timeout = '5s';`);
    const benchmark = Benchmark.measure();
    await trx.raw(`
      SELECT pg_advisory_xact_lock(?, ?);
    `, [lockId[0], lockId[1]]);
    this.logger.debug("Acquiring pg_advisory_xact_lock", benchmark.elapsed());
  }

  private async loadLastSortKey(contractTxId: string, trx: Knex.Transaction): Promise<SortKeyMutexResult> {
    const benchmark = Benchmark.measure();
    this.logger.debug("Loading lastSortKey", benchmark.elapsed());

    const result = await trx.raw(
      `SELECT 'sort_key'    as type,
              max(sort_key) AS "lastSortKey",
              null          as "finishedBlockHeight",
              null          as "finishedBlockHash",
              null          as "finishedBlockTimestamp"
       FROM interactions
       WHERE contract_id = ?
       UNION ALL
       SELECT 'finished_block' as type, null, finished_block_height, finished_block_hash, finished_block_timestamp
       FROM sync_state
       WHERE name = 'Interactions';`, [contractTxId]
    );
    if (result?.rows.length !== 2) {
      throw new Error("Acquire mutex result should have exactly 2 rows in result");
    }
    const sortKeyRow = result?.rows[0].type === "sort_key" ? 0 : 1;
    const finishedBlockRow = result?.rows[0].type === "finished_block" ? 0 : 1;

    return {
      lastSortKey: result?.rows[sortKeyRow].lastSortKey, // note: this will return null if we're registering the very first tx for the contract
      blockHeight: result?.rows[finishedBlockRow].finishedBlockHeight,
      blockHash: result?.rows[finishedBlockRow].finishedBlockHash,
      blockTimestamp: result?.rows[finishedBlockRow].finishedBlockTimestamp
    };
  }

  // https://github.com/binded/advisory-lock/blob/master/src/index.js#L8
  private strToKey(id: string) {
    const buf = createHash("sha256").update(id).digest();
    // Read the first 4 bytes and the next 4 bytes
    // The parameter here is the byte offset, not the sizeof(int32) offset
    return [buf.readInt32LE(0), buf.readInt32LE(4)];
  }
}
