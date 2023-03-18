import { NetworkInfoInterface } from 'arweave/node/network';
import { BlockData } from 'arweave/node/blocks';
import { GatewayContext } from '../init';
import { TaskRunner } from './TaskRunner';
import { BLOCKS_INTERVAL_MS } from './syncTransactions';
import fs from 'fs';
import { fetch } from 'undici';

export type NetworkCacheType = {
  cachedNetworkInfo: NetworkInfoInterface;
  cachedBlockInfo: BlockData;
};

let cache: NetworkCacheType;

export async function runNetworkInfoCacheTask(context: GatewayContext) {
  const { arweave, logger } = context;

  async function updateNetworkInfo() {
    try {
      const newNetworkInfoResponse = await fetch("https://gateway.warp.cc/gateway/arweave/info");
      if (!newNetworkInfoResponse.ok) {
        const message = `An error has occured: ${newNetworkInfoResponse.status}`;
        throw new Error(message);
      }
      const newNetworkInfo = (await newNetworkInfoResponse.json()) as NetworkInfoInterface;

      if (cache?.cachedNetworkInfo && newNetworkInfo && newNetworkInfo.height < cache.cachedNetworkInfo.height) {
        logger.warn('New network height lower than current, skipping.', {
          currentHeight: cache?.cachedNetworkInfo.height,
          newHeight: newNetworkInfo.height,
        });
        return;
      }

      const cachedNetworkInfo = newNetworkInfo;
      const cachedBlockInfo = await arweave.blocks.get(cachedNetworkInfo.current as string);

      (cachedBlockInfo as any).poa = {};
      (cachedBlockInfo as any).txs = [];

      cache = {
        cachedNetworkInfo,
        cachedBlockInfo,
      };

      // fs.writeFileSync('network-cache.json', JSON.stringify(cache), 'utf-8');
      logger.debug('New network height', cache.cachedNetworkInfo.height);
    } catch (e) {
      logger.error('Error while loading network info', e);
    }
  }

  await TaskRunner.from(
    '[Arweave network info]',
    async () => {
      logger.debug('Loading network info');
      if (cache?.cachedNetworkInfo == null || cache?.cachedBlockInfo == null) {
        while (cache?.cachedNetworkInfo == null || cache?.cachedBlockInfo == null) {
          await updateNetworkInfo();
        }
      } else {
        await updateNetworkInfo();
      }
    },
    context
  ).runSyncEvery(BLOCKS_INTERVAL_MS, true);
}

export function getCachedNetworkData(): NetworkCacheType {
  return cache;
}
