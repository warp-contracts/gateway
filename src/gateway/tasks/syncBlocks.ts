import Application from "koa";
import {
  Benchmark,
  GQLEdgeInterface,
  GQLResultInterface, GQLTagInterface,
  GQLTransactionsResultInterface,
  SmartWeaveTags
} from "redstone-smartweave";
import {INTERACTIONS_TABLE} from "../runGateway";
import {sleep} from "../../utils";

// in theory avg. block time on Arweave is 120s (?)
const BLOCKS_INTERVAL_MS = 90 * 1000;
const LOAD_PAST_BLOCKS = 10;
const MAX_GQL_REQUEST = 100;
const GQL_RETRY_MS = 30 * 1000;
// that's a limit for sqlite
const MAX_BATCH_INSERT = 500;
const QUERY = `query Transactions($tags: [TagFilter!]!, $blockFilter: BlockFilter!, $first: Int!, $after: String) {
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
        }
        cursor
      }
    }
  }`;

interface TagFilter {
  name: string;
  values: string[];
}

interface BlockFilter {
  min?: number;
  max: number;
}

interface ReqVariables {
  tags: TagFilter[];
  blockFilter: BlockFilter;
  first: number;
  after?: string;
}


export async function runSyncBlocksTask(context: Application.BaseContext) {
  await syncBlocks(context);
  (function syncBlocksLoop() {
    // not using setInterval on purpose -
    // https://developer.mozilla.org/en-US/docs/Web/API/setInterval#ensure_that_execution_duration_is_shorter_than_interval_frequency
    setTimeout(async function () {
      await syncBlocks(context);
      syncBlocksLoop();
    }, BLOCKS_INTERVAL_MS);
  })();
}

async function syncBlocks(context: Application.BaseContext) {
  const {gatewayDb, arweave, gatewayLogger: logger} = context;
  logger.info("Syncing blocks");

  // 1. find last processed block height and current Arweave network height
  let results: any[];
  try {
    results = await Promise.allSettled([
      gatewayDb("interactions")
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
  const lastProcessedBlockHeight = results[0].value["block_height"];

  logger.debug("Network info", {
    currentNetworkHeight,
    lastProcessedBlockHeight,
  });

  const blocksDiff = currentNetworkHeight - lastProcessedBlockHeight;

  const heightFrom = lastProcessedBlockHeight - LOAD_PAST_BLOCKS - blocksDiff;
  const heightTo = currentNetworkHeight;

  logger.debug("Loading interactions for blocks", {
    heightFrom,
    heightTo,
  });

  // 2. load interactions
  let gqlInteractions: GQLEdgeInterface[]
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
    logger.error("Error while loading interactions", e.message);
    return;
  }

  if (gqlInteractions.length === 0) {
    logger.info("Now new interactions");
    return;
  }

  logger.info(`Found ${gqlInteractions.length} interactions`);

  // 3. map interactions into inserts to "interactions" table
  let interactionsInserts: INTERACTIONS_TABLE[] = [];
  const interactionsInsertsIds = new Set<String>();

  for (let i = 0; i < gqlInteractions.length; i++) {
    const interaction = gqlInteractions[i];
    const blockId = interaction.node.block.id;
    let contractId, input, functionName;

    const contractTag = findTag(interaction, SmartWeaveTags.CONTRACT_TX_ID);
    const inputTag = findTag(interaction, SmartWeaveTags.INPUT);

    // Eyes Pop - Skin Explodes - Everybody Dead
    if (contractTag === undefined || inputTag === undefined) {
      logger.error("Contract or input tag not found for interaction", interaction);
      continue;
      // TODO: probably would be wise to save such stuff in a separate table?
    } else {
      contractId = contractTag.value;
      input = inputTag.value;
    }

    try {
      functionName = JSON.parse(input).function;
    } catch (e) {
      logger.error("Could not parse function name", {
        id: interaction.node.id,
        input: input,
      });
      functionName = "[Error during parsing function name]";
    }

    // now this one is really fucked-up - if the interaction contains the same tag X-times,
    // the default GQL endpoint will return this interaction X-times...
    // this is causing "SQLITE_CONSTRAINT: UNIQUE constraint failed: interactions.id"
    // - and using "ON CONFLICT" does not work here - as it works only for
    // the rows currently stored in db - not the ones that we're trying to batch insert.
    if (interactionsInsertsIds.has(interaction.node.id)) {
      logger.warn("Interaction already added", interaction.node.id);
    } else {
      interactionsInsertsIds.add(interaction.node.id)
      interactionsInserts.push({
        interaction_id: interaction.node.id,
        interaction: JSON.stringify(interaction.node),
        block_height: interaction.node.block.height,
        block_id: blockId,
        contract_id: contractId,
        function: functionName,
        input: input,
        confirmation_status: "not_processed",
      });
    }

    // why using onConflict.merge()?
    // because it happened once that GQL endpoint returned the exact same transactions
    // twice - for different block heights (827991 and then 827993) :facepalm:
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
    if (interactionsInserts.length === MAX_BATCH_INSERT) {
      try {
        logger.info(`Batch insert ${MAX_BATCH_INSERT} interactions.`);
        const interactionsInsertResult: any =
          await gatewayDb("interactions")
            .insert(interactionsInserts)
            .onConflict("interaction_id")
            .merge();

        logger.debug(`Inserted ${interactionsInsertResult.rowCount}`);
        interactionsInserts = [];
      } catch (e) {
        // note: not sure how to behave in this case...
        // if we continue the processing, there's a risk that some blocks/interactions will be skipped.
        logger.error(e);
        return;
      }
    }
  }

  // 4. inserting the rest interactions into DB
  logger.info(`Saving last`, interactionsInserts.length);

  if (interactionsInserts.length > 0) {
    try {
      const interactionsInsertResult: any = await gatewayDb("interactions")
        .insert(interactionsInserts)
        .onConflict("interaction_id")
        .merge();
      logger.debug(`Inserted ${interactionsInsertResult.rowCount}`);
    } catch (e) {
      logger.error(e);
      return;
    }
  }
}

// TODO: verify internalWrites
async function load(
  context: Application.BaseContext,
  from: number,
  to: number
): Promise<GQLEdgeInterface[]> {
  const mainTransactionsVariables: ReqVariables = {
    tags: [
      {
        name: SmartWeaveTags.APP_NAME,
        values: ["SmartWeaveAction"],
      },
    ],
    blockFilter: {
      min: from,
      max: to,
    },
    first: MAX_GQL_REQUEST,
  };

  return await loadPages(context, mainTransactionsVariables);

  async function loadPages(
    context: Application.BaseContext,
    variables: ReqVariables
  ) {
    let transactions = await getNextPage(context, variables);

    const txInfos: GQLEdgeInterface[] = transactions.edges.filter(
      (tx) => !tx.node.parent || !tx.node.parent.id
    );

    while (transactions.pageInfo.hasNextPage) {
      const cursor = transactions.edges[MAX_GQL_REQUEST - 1].cursor;

      variables = {
        ...variables,
        after: cursor,
      };

      transactions = await getNextPage(context, variables);

      txInfos.push(
        ...transactions.edges.filter(
          (tx) => !tx.node.parent || !tx.node.parent.id
        )
      );
    }
    return txInfos;
  }

  async function getNextPage(
    context: Application.BaseContext,
    variables: ReqVariables
  ): Promise<GQLTransactionsResultInterface> {
    const {arweave, gatewayLogger: logger} = context;

    const benchmark = Benchmark.measure();
    let response = await arweave.api.post("graphql", {
      query: QUERY,
      variables,
    });
    logger.debug("GQL page load:", benchmark.elapsed());

    while (response.status === 403) {
      logger.warn(`GQL rate limiting, waiting ${GQL_RETRY_MS}ms before next try.`);

      await sleep(GQL_RETRY_MS);

      response = await arweave.api.post("graphql", {
        query: QUERY,
        variables,
      });
    }

    if (response.status !== 200) {
      throw new Error(`Unable to retrieve transactions. Arweave gateway responded with status ${response.status}.`);
    }

    if (response.data.errors) {
      logger.error(response.data.errors);
      throw new Error("Error while loading interaction transactions");
    }

    const data: GQLResultInterface = response.data;

    return data.data.transactions;
  }
}

function findTag(
  interaction: GQLEdgeInterface,
  tagName: string
): GQLTagInterface | undefined {
  return interaction.node.tags.find((t) => {
    return t.name === tagName;
  });
}
