import {NetworkInfoInterface} from "arweave/node/network";
import {BlockData} from "arweave/node/blocks";
import {GatewayContext} from "../init";
import {TaskRunner} from "./TaskRunner";
import {BLOCKS_INTERVAL_MS} from "./syncTransactions";

export let cachedNetworkInfo: Partial<NetworkInfoInterface> | null = null;
export let cachedBlockInfo: BlockData | null = null;

export async function runNetworkInfoCacheTask(context: GatewayContext) {
  const {arweave, logger, arweaveWrapper} = context;

  await TaskRunner
    .from("[Arweave network info]", async () => {
      logger.debug("Loading network info");
      try {
        cachedNetworkInfo = await arweaveWrapper.info();
        cachedBlockInfo = await arweave.blocks.get(cachedNetworkInfo.current as string);
        logger.debug("New network height", cachedNetworkInfo.height);
      } catch (e) {
        logger.error("Error while loading network info", e);
        cachedNetworkInfo = null;
        cachedBlockInfo = null;
      }
    }, context)
    .runSyncEvery(BLOCKS_INTERVAL_MS, true);
}
