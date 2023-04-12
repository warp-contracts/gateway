import { GQLEdgeInterface, WarpLogger, SmartWeaveTags, TagsParser } from 'warp-contracts';
import { TaskRunner } from './TaskRunner';
import { GatewayContext } from '../init';
import { loadPages, MAX_GQL_REQUEST, ReqVariables } from '../../gql';
import { isTxIdValid } from '../../utils';
import { publishInteraction, sendNotification } from '../publisher';
import { DatabaseSource } from '../../db/databaseSource';
import { InteractionInsert } from '../../db/insertInterfaces';
import fs from 'fs';
import { getCachedNetworkData } from './networkInfoCache';

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
  await TaskRunner.from('[sync last hour transactions]', syncLastHourTransactions, context).runSyncEvery(
    HOUR_INTERVAL_MS
  );
}

export async function runSyncLastSixHoursTransactionsTask(context: GatewayContext) {
  await TaskRunner.from('[sync last 6 hours transactions]', syncLastSixHoursTransactionsTask, context).runSyncEvery(
    DAY_INTERVAL_MS
  );
}

function syncLastTransactions(context: GatewayContext) {
  return syncTransactions(context, 5, true);
}

function syncLastHourTransactions(context: GatewayContext) {
  return syncTransactions(context, AVG_BLOCKS_PER_HOUR);
}

function syncLastSixHoursTransactionsTask(context: GatewayContext) {
  return syncTransactions(context, AVG_BLOCKS_PER_HOUR * 6);
}

async function syncTransactions(context: GatewayContext, pastBlocksAmount: number, publish = false) {
  const { dbSource, logger, sorter } = context;

  logger.info('Syncing L1 interactions');

  let lastProcessedBlockHeight;
  if (fs.existsSync('interactions-sync-l1.json')) {
    const data = JSON.parse(fs.readFileSync('interactions-sync-l1.json', 'utf-8'));
    lastProcessedBlockHeight = data?.lastProcessedBlockHeight;
  } else {
    let result: any;
    try {
      result = await dbSource.selectLastProcessedArweaveInteraction();
      lastProcessedBlockHeight = result?.block_height;
    } catch (e: any) {
      logger.error('Error while loading last loaded arweave interaction', e.message);
      return;
    }
  }

  const currentNetworkHeight = getCachedNetworkData().cachedNetworkInfo.height;
  // note: the first SW interaction was registered at 472810 block height
  lastProcessedBlockHeight = lastProcessedBlockHeight || FIRST_SW_TX_BLOCK_HEIGHT;

  logger.debug('Network info', {
    currentNetworkHeight,
    lastProcessedBlockHeight,
  });

  const heightFrom = lastProcessedBlockHeight - pastBlocksAmount;
  let heightTo = currentNetworkHeight;

  // note: only main task should have this protection. The 'last hour' and 'last 6 hours' tasks
  // will obviously try to resync more blocks.
  if (publish) {
    if (heightTo > heightFrom + 20) {
      heightTo = heightFrom + 20;
    }
  }

  logger.info('Loading interactions for blocks', {
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
    // note: publish is set to true only for the main syncing task - and also only this task should
    // store info about last processed height
    if (publish) {
      fs.writeFileSync('interactions-sync-l1.json', JSON.stringify({lastProcessedBlockHeight: heightTo}), 'utf-8');
    }
    return;
  }

  logger.info(`Found ${gqlInteractions.length} interactions`);

  // 3. map interactions into inserts to "interactions" table
  let interactionsInserts: InteractionInsert[] = [];
  const interactionsInsertsIds = new Set<string>();

  const contracts = new Map();

  for (let i = 0; i < gqlInteractions.length; i++) {
    const interaction = gqlInteractions[i];
    const blockId = interaction.node.block.id;

    const contractId = tagsParser.getContractTag(interaction.node);
    const input = tagsParser.getInputTag(interaction.node, contractId)?.value;
    const parsedInput = safeParseInput(input, logger);

    const functionName = parsedInput ? parsedInput.function : '[Error during parsing function name]';

    let evolve: string | null;

    evolve =
      functionName == 'evolve' && parsedInput?.value && isTxIdValid(parsedInput?.value) ? parsedInput?.value : null;

    const internalWrites = tagsParser.getInteractWritesContracts(interaction.node);

    if (contractId === undefined || input === undefined) {
      logger.error('Contract or input tag not found for interaction', interaction);
      continue;
    }

    const sortKey = await sorter.createSortKey(blockId, interaction.node.id, interaction.node.block.height);
    const testnet = testnetVersion(interaction);
    const syncTimestamp = Date.now();
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
        block_timestamp: interaction.node.block.timestamp,
        block_id: blockId,
        contract_id: contractId,
        function: functionName,
        input: input,
        confirmation_status: 'not_processed',
        interact_write: internalWrites,
        sort_key: sortKey,
        evolve: evolve,
        testnet,
        owner: interaction.node.owner.address,
        sync_timestamp: syncTimestamp,
      });
    }
    if (interactionsInserts.length === MAX_BATCH_INSERT) {
      try {
        logger.info(`Batch insert ${MAX_BATCH_INSERT} interactions.`);
        const interactionsInsertResult: any = await insertInteractions(dbSource, interactionsInserts);

        logger.debug(`Inserted ${interactionsInsertResult.rowCount}`);
        interactionsInserts = [];
      } catch (e) {
        // note: not sure how to behave in this case...
        // if we continue the processing, there's a risk that some blocks/interactions will be skipped.
        logger.error(e);
        return;
      }
    }
    contracts.set(interaction.node.id, {
      contractId,
      interaction: interaction.node,
      blockHeight: interaction.node.block.height,
      sortKey,
      source: 'arweave',
      syncTimestamp,
      functionName,
      testnet,
    });
  }

  // 4. inserting the rest interactions into DB
  logger.info(`Saving last`, interactionsInserts.length);

  if (interactionsInserts.length > 0) {
    try {
      const interactionsInsertResult: any = await insertInteractions(dbSource, interactionsInserts);
      logger.debug(`Inserted ${interactionsInsertResult.rowCount}`);
    } catch (e) {
      logger.error(e);
      return;
    } finally {
      if (publish) {
        fs.writeFileSync('interactions-sync-l1.json', JSON.stringify({lastProcessedBlockHeight: heightTo}), 'utf-8');
      }
    }
  } else {
    if (publish) {
      fs.writeFileSync('interactions-sync-l1.json', JSON.stringify({lastProcessedBlockHeight: heightTo}), 'utf-8');
    }
  }

  if (publish) {
    for (let [key, value] of contracts) {
      sendNotification(context, value.contractId, undefined, value.interaction);
      publishInteraction(
        context,
        value.contractId,
        value.interaction,
        value.sortKey,
        null,
        value.functionName,
        value.source,
        value.syncTimestamp,
        value.testnet
      );
    }
  }
}

async function insertInteractions(dbSource: DatabaseSource, interactionsInserts: InteractionInsert[]) {
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
  return await dbSource.insertInteractionsSync(interactionsInserts);
}

// TODO: verify internalWrites
async function load(context: GatewayContext, from: number, to: number): Promise<GQLEdgeInterface[]> {
  const mainTransactionsVariables: ReqVariables = {
    bundledIn: null,
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

  const { logger, arweaveWrapperGqlGoldsky } = context;
  return await loadPages({ logger, arweaveWrapper: arweaveWrapperGqlGoldsky }, INTERACTIONS_QUERY, mainTransactionsVariables);
}

export function testnetVersion(tx: GQLEdgeInterface): string | null {
  return tx.node.tags.find((tag) => tag.name === 'Warp-Testnet')?.value || null;
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

function safeParseInput(input: string, logger: WarpLogger) {
  try {
    return JSON.parse(input);
  } catch (e) {
    logger.error('Could not parse input', {
      input,
    });
    return null;
  }
}
