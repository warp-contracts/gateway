import {TaskRunner} from "./TaskRunner";
import {GatewayContext} from "../init";
import {loadPages} from './utils/gqlPageLoading';
import {MIN_BLOCK_HEIGHT} from '../../constants';

const STATS_INTERVAL_MS = 3 * 60 * 60 * 1000;

const QUERY = `
query Transactions($tags: [TagFilter!]!, $blockFilter: BlockFilter!, $first: Int!, $after: String) {
  transactions(tags: $tags, block: $blockFilter, first: $first, sort: HEIGHT_ASC, after: $after) {
    pageInfo {
        hasNextPage
      }
      edges {
        node {
          id
          owner {
            address
          }
          tags {
            name
            value
          }
          fee { 
            winston
            ar
          }
          data {
            type
          }
          block {
            id
            timestamp
            height
          }
        }
        cursor
      }
    }
  }
`

export async function runStatsTask(context: GatewayContext) {
  await TaskRunner
    .from("[stats]", loadStats, context)
    .runAsyncEvery(STATS_INTERVAL_MS);
}

async function loadStats(context: GatewayContext) {
  const {logger, gatewayDb, arweave} = context;

  let results: any[];
  try {
    results = await Promise.allSettled([
      gatewayDb("stats_contracts")
        .select("block_height")
        .orderBy("block_height", "desc")
        .limit(1)
        .first(),
      arweave.network.getInfo(),
    ]);
  } catch (e: any) {
    logger.error("Error while checking new blocks", e.message);
    return;
  }

  const rejections = results.filter((r) => {
    return r.status === "rejected";
  });

  if (rejections.length > 0) {
    logger.error("Error while processing next block", rejections.map((r) => r.message));
    return;
  }

  const currentNetworkHeight = results[1].value.height;
  
  const lastProcessedBlockHeight = results[0].value?.block_height || MIN_BLOCK_HEIGHT;
  logger.debug(`Last processed block height: ${lastProcessedBlockHeight}`);

  logger.debug("Network info", {
    currentNetworkHeight,
    lastProcessedBlockHeight,
  });

  const heightFrom = parseInt(lastProcessedBlockHeight) - 10;
  let heightTo = currentNetworkHeight;
  if (heightTo > heightFrom + 7000) {
    heightTo = heightFrom + 7000;
  }

  logger.debug("Loading contracts for blocks", {
    heightFrom,
    heightTo,
  });

  const variables = {
      tags: [
        {
          name: 'App-Name',
          values: ['SmartWeaveContract']
        }
      ],
      blockFilter: {
        min: heightFrom,
        max: heightTo,
      },
      first: 100
    }

  const contracts = await loadPages(context, variables, QUERY);

  for (let i = 0; i< contracts.length; i++) {
    try {
      await gatewayDb("stats_contracts")
        .insert({
          contract_id: contracts[i].node.id,
          owner: contracts[i].node.owner.address, 
          block_height: contracts[i].node.block.height,
          block_id: contracts[i].node.block.id,
          timestamp: contracts[i].node.block.timestamp,
          fee: contracts[i].node.fee
        })
        .onConflict("contract_id")
        .merge();
    } catch (e) {
      logger.error("Error while loading contract stats", e);

    }

    for (let j = 0; j < contracts[i].node.tags.length; j++) {
      try {
        await gatewayDb("stats_tags")
          .insert({
            contract_id: contracts[i].node.id,
            value: contracts[i].node.tags[j].value,
            name: contracts[i].node.tags[j].name
          })
          .onConflict("contract_id")
          .ignore();
      } catch (e) {
        logger.error("Error while loading tags")
      }
    }
  }

}
