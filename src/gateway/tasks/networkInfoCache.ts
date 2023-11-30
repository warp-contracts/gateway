import { NetworkInfoInterface } from "arweave/node/network";
import { BlockData } from "arweave/node/blocks";
import { GatewayContext } from "../init";
import { TaskRunner } from "./TaskRunner";
import { Knex } from "knex";
import Arweave from "arweave";
import { DatabaseSource } from "../../db/databaseSource";
import { sleep } from "../../utils";

export type NetworkCacheType = {
  cachedNetworkInfo: NetworkInfoInterface;
  cachedBlockInfo: BlockData;
};


export async function runNetworkInfoCacheTask(context: GatewayContext) {
  const { arweave, logger, arweaveWrapper, pgAdvisoryLocks, dbSource } = context;

  async function updateNetworkInfo() {
    // @ts-ignore
    const trx = (await dbSource.primaryDb.transaction()) as Knex.Transaction;

    try {
      const currentArweaveBlock = await pgAdvisoryLocks.acquireArweaveHeightMutex(trx);
      if (currentArweaveBlock === undefined) {
        logger.debug("Network info already locked, skipping");
        await trx.commit();
        return;
      }

      const newNetworkInfo = await arweaveWrapper.info();
      logger.debug("New network info", newNetworkInfo);
      if (currentArweaveBlock === null) {
        logger.debug("Current arweave block null, inserting");
        const additionalData = await prepareCacheData(arweave, newNetworkInfo);
        await trx.raw(`
            INSERT INTO sync_state(name, finished_block_height, finished_block_hash, additional_data)
            VALUES ('Arweave',
                    :block_height,
                    :block_hash,
                    :additional_data);
        `, {
          block_height: newNetworkInfo.height,
          block_hash: newNetworkInfo.current,
          additional_data: additionalData
        });
      } else {
        if (newNetworkInfo && newNetworkInfo.height <= currentArweaveBlock.blockHeight) {
          logger.debug("New network height lower or equal than current, skipping.", {
            currentHeight: currentArweaveBlock.blockHeight,
            newHeight: newNetworkInfo.height
          });
          await sleep(1000);
          await trx.commit();
          return;
        }

        const additionalData = await prepareCacheData(arweave, newNetworkInfo);
        await trx.raw(`
            UPDATE sync_state
            SET finished_block_height=:block_height,
                finished_block_hash=:block_hash,
                additional_data=:additional_data
            WHERE name = 'Arweave';
        `, {
          block_height: newNetworkInfo.height,
          block_hash: newNetworkInfo.current,
          additional_data: additionalData
        });
      }
      // hold lock for a while, so that other process that are trying to check the height
      // at about the same time - will get blocked
      await sleep(1000);
      await trx.commit();
      logger.debug("New network height", newNetworkInfo.height);
    } catch (e) {
      if (trx != null) {
        await trx.rollback();
      }
      logger.error("Error while loading network info", e);
    }
  }

  await TaskRunner.from(
    "[Arweave network info]",
    async () => {
      logger.debug("Loading network info");
      await updateNetworkInfo();
    },
    context
  ).runSyncEvery(40 * 1000, true);
}

export async function getCachedNetworkData(dbSource: DatabaseSource): Promise<NetworkCacheType> {
  // @ts-ignore
  const result = await dbSource.primaryDb.raw(`
      SELECT additional_data
      FROM sync_state
      WHERE name = 'Arweave';
  `);

  if (result?.rows?.length !== 1) {
    throw new Error("Cached Arweave network data not available.");
  }

  return result.rows[0].additional_data;
}

async function prepareCacheData(arweave: Arweave, newNetworkInfo: NetworkInfoInterface): Promise<NetworkCacheType> {
  const cachedNetworkInfo = newNetworkInfo;
  const cachedBlockInfo = await arweave.blocks.get(cachedNetworkInfo.current as string);

  (cachedBlockInfo as any).poa = {};
  (cachedBlockInfo as any).txs = [];
  (cachedBlockInfo as any).poa2 = {};

  return {
    cachedNetworkInfo,
    cachedBlockInfo
  };
}
