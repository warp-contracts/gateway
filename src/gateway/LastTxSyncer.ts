import {Mutex, MutexInterface} from "async-mutex";
import {Knex} from "knex";
import {LoggerFactory} from "warp-contracts";

export class LastTxSync {

  private readonly logger = LoggerFactory.INST.create(LastTxSync.name);

  constructor(private readonly gatewayDb: Knex) {
  }

  // a map from contractTxId to Mutex
  private readonly contractsMutex = new Map<string, Mutex>();

  // a map from contractTxId to sortKey - i.e. the 'previous' sortKey
  private readonly lastSortKey = new Map<string, string | null>();

  // a global mutex used to acquire contract mutex from contract->mutex map
  // for simplicity we could use only this global mutex, but this would greatly reduce tps
  // - we could process only one transaction at any time.
  // With per contract mutex - we can process one transaction PER contract.
  private readonly mainMutex = new Mutex();

  async acquireMutex(contractTxId: string): Promise<MutexInterface.Releaser> {
    // note: operation of acquiring per-contract mutex is not atomic
    // - and therefore needs to be synchronized globally - via 'mainMutex'
    // without this synchronization it could happen that two requests would
    // create and acquire two independent 'contract' mutexes.
    const mainRelease = await this.mainMutex.acquire();
    this.logger.debug('Main mutex acquired', contractTxId);
    try {
      let contractMutex = this.contractsMutex.get(contractTxId);
      if (contractMutex === undefined) {
        contractMutex = new Mutex();
        this.contractsMutex.set(contractTxId, contractMutex);
      }
      const release = await contractMutex.acquire();
      this.logger.debug(`Mutex for ${contractTxId} acquired.`);
      return release;
    } catch (e) {
      this.logger.error('Error while acquiring contract mutex', e);
      throw e;
    } finally {
      mainRelease();
      this.logger.debug('Main mutex released', contractTxId);
    }
  }

  async getLastSortKey(contractTxId: string): Promise<string | null> {
    let contractLastTx: string | undefined | null = this.lastSortKey.get(contractTxId);
    if (contractLastTx === undefined) {
      contractLastTx = await this.loadLastSortKey(contractTxId);
      // we're storing the value just in case the further processing would fail
      // - the next request for this contract won't have to load it again from db
      this.lastSortKey.set(contractTxId, contractLastTx);
    }
    this.logger.debug('Last tx', {
      contractTxId,
      contractLastTx
    });

    return contractLastTx;
  }

  async updateLastSortKey(contractTxId: string, sortKey: string): Promise<void> {
    this.logger.debug('Update last tx', {
      contractTxId,
      sortKey
    });
    this.lastSortKey.set(contractTxId, sortKey);
  }

  private async loadLastSortKey(contractTxId: string): Promise<string | null> {
    const result = await this.gatewayDb.raw(
      `SELECT max(sort_key) AS "lastSortKey"
       FROM interactions
       WHERE contract_id = ?`,
      [contractTxId]
    )

    // note: this will return null if we're registering the very first tx for the contract
    return result?.rows[0].lastSortKey;
  }
}
