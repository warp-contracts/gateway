import { Knex } from "knex";
import Application from "koa";
import {
  Benchmark,
  GQLEdgeInterface,
  GQLResultInterface,
  GQLTagInterface,
  GQLTransactionsResultInterface,
  SmartWeaveTags,
} from "redstone-smartweave";
import { sleep } from "../utils";

const MAX_REQUEST = 100;

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

export type INTERACTIONS_TABLE = {
  id: string;
  transaction: string;
  block_height: number;
  block_id: string;
  contract_id: string;
  function: string;
  input: string;
  confirmation_status: string;
};

// in theory avg. block time on Arweave is 120s (?)
const INTERVAL_MS = 90 * 1000;

const GQL_RETRY_MS = 30 * 1000;

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

export async function initBlocksDb(db: Knex) {
  if (!(await db.schema.hasTable("interactions"))) {
    await db.schema.createTable("interactions", (table) => {
      table.string("id", 64).primary();
      table.json("transaction").notNullable();
      table.bigInteger("block_height").notNullable().index();
      table.string("block_id").notNullable();
      table.string("contract_id").notNullable().index();
      table.string("function").index();
      table.json("input").notNullable();
      table
        .string("confirmation_status")
        .notNullable()
        .defaultTo("not_processed");
    });
  }
}

export async function blockListener(context: Application.BaseContext) {
  await doListenForBlocks(context);

  setTimeout(async function () {
    (function loop() {
      // not using setInterval on purpose -
      // https://developer.mozilla.org/en-US/docs/Web/API/setInterval#ensure_that_execution_duration_is_shorter_than_interval_frequency
      setTimeout(async function () {
        await doListenForBlocks(context);
        loop();
      }, INTERVAL_MS);
    })();
  }, INTERVAL_MS);
}

async function doListenForBlocks(context: Application.BaseContext) {
  await Promise.allSettled([
    checkNewBlocks(context),
    verifyConfirmations(context),
  ]);
}

// TODO: implement ;-)
function verifyConfirmations(context: Application.BaseContext) {
  return Promise.resolve(undefined);
}

async function checkNewBlocks(context: Application.BaseContext) {
  const { blocksDb, arweave, logger } = context;
  logger.info("Searching for new block");

  // 1. find last processed block height and current Arweave network height
  const results: any[] = await Promise.allSettled([
    blocksDb("interactions")
      .select("block_height")
      .orderBy("block_height", "desc")
      .limit(1)
      .first(),
    arweave.network.getInfo(),
  ]);
  const rejections = results.filter((r) => {
    return r.status === "rejected";
  });
  if (rejections.length > 0) {
    logger.error(
      "Error while processing next block",
      rejections.map((r) => r.reason)
    );
    return;
  }

  const currentNetworkHeight = results[1].value.height;
  const lastProcessedBlockHeight = results[0].value["block_height"];

  logger.debug("Network info", {
    currentNetworkHeight,
    lastProcessedBlockHeight,
  });

  if (lastProcessedBlockHeight === currentNetworkHeight) {
    logger.warn("No new blocks, nothing to do");
    return;
  }

  // 2. load interactions [last processed block + 1, currentNetworkHeight]
  const interactions: GQLEdgeInterface[] = await load(
    context,
    lastProcessedBlockHeight + 1,
    currentNetworkHeight
  );
  logger.info(`Found ${interactions.length} interactions`);

  // 3. map interactions into inserts into "interactions" tables
  let interactionsInserts: INTERACTIONS_TABLE[] = [];

  for (let i = 0; i < interactions.length; i++) {
    const interaction = interactions[i];
    const blockId = interaction.node.block.id;
    let contractId, input, functionName;

    const contractTag = findTag(interaction, SmartWeaveTags.CONTRACT_TX_ID);
    const inputTag = findTag(interaction, SmartWeaveTags.INPUT);

    // Eyes Pop - Skin Explodes - Everybody Dead
    if (contractTag === undefined || inputTag === undefined) {
      logger.error(
        "Contract or input tag not found for interaction",
        interaction
      );
      continue;
      // TODO: probably would be wise to save such stuff in a separate table
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
      functionName = "Error during parsing function name";
    }

    if (
      interactionsInserts.find((i) => i.id === interaction.node.id) !==
      undefined
    ) {
      logger.warn("Interaction already added", interaction.node.id);
    } else {
      interactionsInserts.push({
        id: interaction.node.id,
        transaction: JSON.stringify(interaction.node),
        block_height: interaction.node.block.height,
        block_id: blockId,
        contract_id: contractId,
        function: functionName,
        input: input,
        confirmation_status: "not_processed",
      });
    }

    // note: max batch insert for sqlite
    if (interactionsInserts.length === 500) {
      try {
        logger.info("Batch insert");
        const interactionsInsertResult = await blocksDb("interactions").insert(
          interactionsInserts
        );
        logger.info("interactionsInsertResult", interactionsInsertResult);
        interactionsInserts = [];
      } catch (e) {
        logger.error(e);
        process.exit(0);
      }
    }
  }

  // 4. inserting the reset interactions into DB
  logger.info(`Saving last`, interactionsInserts.length);

  if (interactionsInserts.length > 0) {
    try {
      const interactionsInsertResult = await blocksDb("interactions").insert(
        interactionsInserts
      );
      logger.info("interactionsInsertResult", interactionsInsertResult);
    } catch (e) {
      logger.error(e);
      process.exit(0);
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
    first: MAX_REQUEST,
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
      const cursor = transactions.edges[MAX_REQUEST - 1].cursor;

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
    const { arweave, logger } = context;

    const benchmark = Benchmark.measure();
    let response = await arweave.api.post("graphql", {
      query: QUERY,
      variables,
    });
    logger.debug("GQL page load:", benchmark.elapsed());

    while (response.status === 403) {
      logger.warn(
        `GQL rate limiting, waiting ${GQL_RETRY_MS}ms before next try.`
      );

      await sleep(GQL_RETRY_MS);

      response = await arweave.api.post("graphql", {
        query: QUERY,
        variables,
      });
    }

    if (response.status !== 200) {
      throw new Error(
        `Unable to retrieve transactions. Arweave gateway responded with status ${response.status}.`
      );
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
