import { GQLEdgeInterface, WarpLogger, SmartWeaveTags, TagsParser } from 'warp-contracts';
import { TaskRunner } from './TaskRunner';
import { GatewayContext } from '../init';
import { INTERACTIONS_TABLE } from '../../db/schema';
import { loadPages, MAX_GQL_REQUEST, ReqVariables } from '../../gql';
import { Knex } from 'knex';
import { isTxIdValid } from '../../utils';
import {updateCache} from "../updateCache";

const INTERACTIONS_QUERY = `query Transactions($tags: [TagFilter!]!, $blockFilter: BlockFilter!, $first: Int!, $after: String) {
    transactions(tags: $tags, block: $blockFilter, first: $first, sort: HEIGHT_ASC, after: $after) {
      pageInfo {
        hasNextPage
      }
      edges {
        node {
          id
          owner { address }
          recipient
          tags {
            name
            value
          }
          block {
            height
            id
            timestamp
          }
          fee { winston }
          quantity { winston }
          parent { id }
          bundledIn { id }
        }
        cursor
      }
    }
  }`;

const tagsParser = new TagsParser();

// in theory avg. block time on Arweave is 120s (?)
// in fact, it varies from ~20s to minutes...
export const BLOCKS_INTERVAL_MS = 30 * 1000;
export const FIRST_SW_TX_BLOCK_HEIGHT = 472810;
const LOAD_PAST_BLOCKS = 50; // smartweave interaction are currently somewhat rare...
// that was a limit for sqlite, but let's leave it for now...
export const MAX_BATCH_INSERT = 500;

const AVG_BLOCK_TIME_SECONDS = 60;
export const AVG_BLOCKS_PER_HOUR = (60 * 60) / AVG_BLOCK_TIME_SECONDS + 10;
const AVG_BLOCKS_PER_DAY = (60 * 60 * 24) / AVG_BLOCK_TIME_SECONDS + 60;

const HOUR_INTERVAL_MS = 60 * 60 * 1000;
const DAY_INTERVAL_MS = HOUR_INTERVAL_MS * 24;

export async function runSyncRecentTransactionsTask(context: GatewayContext) {
  await TaskRunner.from('[sync latest transactions]', syncLastTransactions, context).runSyncEvery(BLOCKS_INTERVAL_MS);
}

export async function runSyncLastHourTransactionsTask(context: GatewayContext) {
  await TaskRunner.from('[sync last hour transactions]', syncLastHourTransactions, context).runAsyncEvery(
    HOUR_INTERVAL_MS
  );
}

export async function runSyncLastDayTransactionsTask(context: GatewayContext) {
  await TaskRunner.from('[sync last day transactions]', syncLastDayTransactions, context).runAsyncEvery(
    DAY_INTERVAL_MS
  );
}

function syncLastTransactions(context: GatewayContext) {
  return syncTransactions(context, LOAD_PAST_BLOCKS, true);
}

function syncLastHourTransactions(context: GatewayContext) {
  return syncTransactions(context, AVG_BLOCKS_PER_HOUR);
}

function syncLastDayTransactions(context: GatewayContext) {
  return syncTransactions(context, AVG_BLOCKS_PER_DAY);
}

async function syncTransactions(context: GatewayContext, pastBlocksAmount: number, publish = false) {
  const { gatewayDb, logger, arweaveWrapper, sorter } = context;

  logger.info('Syncing blocks');

  // 1. find last processed block height and current Arweave network height
  let results: any[];
  try {
    results = await Promise.allSettled([
      gatewayDb('interactions').select('block_height').orderBy('block_height', 'desc').limit(1).first(),
      arweaveWrapper.info(),
    ]);
  } catch (e: any) {
    logger.error('Error while checking new blocks', e.message);
    return;
  }

  const rejections = results.filter((r) => {
    return r.status === 'rejected';
  });

  if (rejections.length > 0) {
    logger.error(
      'Error while processing next block',
      rejections.map((r) => r.message)
    );
    return;
  }

  const currentNetworkHeight = results[1].value.height;
  // note: the first SW interaction was registered at 472810 block height
  const lastProcessedBlockHeight = results[0].value?.block_height || FIRST_SW_TX_BLOCK_HEIGHT;

  logger.debug('Network info', {
    currentNetworkHeight,
    lastProcessedBlockHeight,
  });

  const heightFrom = lastProcessedBlockHeight - pastBlocksAmount;
  let heightTo = currentNetworkHeight;
  if (heightTo > heightFrom + 5000) {
    heightTo = heightFrom + 5000;
  }

  logger.debug('Loading interactions for blocks', {
    heightFrom,
    heightTo,
  });

  // 2. load interactions
  let gqlInteractions: GQLEdgeInterface[];
  try {
    gqlInteractions = await load(
      context,
      // Checking LOAD_PAST_BLOCKS blocks back in the past, as
      // arweave.net GQL endpoint (very) rarely returns no transactions for the latest block
      // - even if there are some transactions in this block...
      // We want to be sure that we won't miss any transaction because of a random Arweave gateway quirk...
      // There's no risk of duplicates, as transaction's id is the primary key of the table
      // - and "ON CONFLICT" clause protects from unique constraint errors.
      heightFrom,
      heightTo
    );
  } catch (e: any) {
    logger.error('Error while loading interactions', e.message);
    return;
  }

  if (gqlInteractions.length === 0) {
    logger.info('Now new interactions');
    return;
  }

  logger.info(`Found ${gqlInteractions.length} interactions`);

  // 3. map interactions into inserts to "interactions" table
  let interactionsInserts: INTERACTIONS_TABLE[] = [];
  const interactionsInsertsIds = new Set<string>();

  const contracts = new Map();

  for (let i = 0; i < gqlInteractions.length; i++) {
    const interaction = gqlInteractions[i];
    const blockId = interaction.node.block.id;

    const contractId = tagsParser.getContractTag(interaction.node);
    const input = tagsParser.getInputTag(interaction.node, contractId)?.value;
    const parsedInput = JSON.parse(input);

    const functionName = parseFunctionName(input, logger);

    let evolve: string | null;

    evolve = functionName == 'evolve' && parsedInput.value && isTxIdValid(parsedInput.value) ? parsedInput.value : null;

    const internalWrites = tagsParser.getInteractWritesContracts(interaction.node);

    if (contractId === undefined || input === undefined) {
      logger.error('Contract or input tag not found for interaction', interaction);
      continue;
    }

    const sortKey = await sorter.createSortKey(blockId, interaction.node.id, interaction.node.block.height);
    const testnet = testnetVersion(interaction);
    // now this one is really fucked-up - if the interaction contains the same tag X-times,
    // the default GQL endpoint will return this interaction X-times...
    // this is causing "SQLITE_CONSTRAINT: UNIQUE constraint failed: interactions.id"
    // - and using "ON CONFLICT" does not work here - as it works only for
    // the rows currently stored in db - not the ones that we're trying to batch insert.
    if (interactionsInsertsIds.has(interaction.node.id)) {
      logger.warn('Interaction already added', interaction.node.id);
    } else {
      interactionsInsertsIds.add(interaction.node.id);
      interactionsInserts.push({
        interaction_id: interaction.node.id,
        interaction: JSON.stringify(interaction.node),
        block_height: interaction.node.block.height,
        block_id: blockId,
        contract_id: contractId,
        function: functionName,
        input: input,
        confirmation_status: 'not_processed',
        interact_write: internalWrites,
        sort_key: sortKey,
        evolve: evolve,
        testnet
      });
    }
    if (interactionsInserts.length === MAX_BATCH_INSERT) {
      try {
        logger.info(`Batch insert ${MAX_BATCH_INSERT} interactions.`);
        const interactionsInsertResult: any = await insertInteractions(gatewayDb, interactionsInserts);

        logger.debug(`Inserted ${interactionsInsertResult.rowCount}`);
        interactionsInserts = [];
      } catch (e) {
        // note: not sure how to behave in this case...
        // if we continue the processing, there's a risk that some blocks/interactions will be skipped.
        logger.error(e);
        return;
      }
    }
    contracts.set(contractId, sortKey);
  }

  // 4. inserting the rest interactions into DB
  logger.info(`Saving last`, interactionsInserts.length);

  if (interactionsInserts.length > 0) {
    try {
      const interactionsInsertResult: any = await insertInteractions(gatewayDb, interactionsInserts);
      logger.debug(`Inserted ${interactionsInsertResult.rowCount}`);
    } catch (e) {
      logger.error(e);
      return;
    }
  }

  for (let [key, value] of contracts) {
    updateCache(key, context, value);
  }
}

async function insertInteractions(gatewayDb: Knex<any, unknown[]>, interactionsInserts: INTERACTIONS_TABLE[]) {
  // why using onConflict.merge()?
  // because it happened once that GQL endpoint returned the exact same transactions
  // twice - for different block heights (827991 and then 827993)
  // For the record, these transactions were:
  // INmaBb6pk0MATLrs3mCw5bjeRCbR2e-j-v4swpWHPTg
  // QIbp0CwxNUwA8xQSS36Au2Lj1QEgnO8n-shQ2d3AWps
  // UJhsjQLhSr1mL4C-t3XvotAhYGIN-P7EkkxNyRRIQ-w
  // UZ1XnYr4waM7Zm77TZduZ4Tx8uS8y9PeyX6kKEPQh10
  // cZHBNtzkSF_MtkZCz1RD8_D9lVjOOYAuEUk2xbdm7LA
  // lwGTY3yEBfxTgPFO4DZMouHWVaXLJu7SxP-hpDb_S2M
  // ouv9X3-ceGPhb2ALVaLq2qzj_ZDgbSmjGj9wz5k5qRo
  // qT-ihh8K3J7Lek4774-GmFoAhU4pemWZPXv66B09xCI
  // qUk-UuPAOaOkoqMP_btCJLYP-c-8kHRKjg_nefQVLgQ

  // note: the same issue occurred recently for tx IoGSPjQ--LY2KRgCBioaX0GTlohCq64IYSFolayuEPg
  // it was first returned for block 868561, and then moved to 868562 - probably due to fork
  return gatewayDb('interactions')
    .insert(interactionsInserts)
    .onConflict('interaction_id')
    .merge(['block_id', 'function', 'input', 'contract_id', 'block_height', 'interaction', 'sort_key']);
}

// TODO: verify internalWrites
async function load(context: GatewayContext, from: number, to: number): Promise<GQLEdgeInterface[]> {
  const mainTransactionsVariables: ReqVariables = {
    tags: [
      {
        name: SmartWeaveTags.APP_NAME,
        values: ['SmartWeaveAction'],
      },
    ],
    blockFilter: {
      min: from,
      max: to,
    },
    first: MAX_GQL_REQUEST,
  };

  const { logger, arweaveWrapper } = context;
  return await loadPages({ logger, arweaveWrapper }, INTERACTIONS_QUERY, mainTransactionsVariables);
}

export function testnetVersion(tx: GQLEdgeInterface): string | null {
  return tx.node.tags.find(
    (tag) => tag.name === 'Warp-Testnet'
  )?.value || null;
}


export function parseFunctionName(input: string, logger: WarpLogger) {
  try {
    return JSON.parse(input).function;
  } catch (e) {
    logger.error('Could not parse function name', {
      input: input,
    });
    return '[Error during parsing function name]';
  }
}
