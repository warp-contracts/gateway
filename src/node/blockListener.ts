import { Knex } from "knex";
import Application from "koa";
import {
  Benchmark,
  GQLEdgeInterface,
  GQLNodeInterface,
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

export type BLOCKS_TABLE = {
  id: string;
  height: number;
  transactions: string;
};

export type INTERACTIONS_TABLE = {
  id: string;
  transaction: string;
  block_height: number;
  block_id: string;
  contract_id: string;
  function: string;
  input: string;
  confirmed: boolean;
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

async function init(db: Knex) {
  // not sure which storage format will be better, so creating two separate tables
  if (!(await db.schema.hasTable("blocks"))) {
    await db.schema.createTable("blocks", (table) => {
      table.string("id", 64).primary();
      table.bigInteger("height").notNullable().unique().index();
      table.json("transactions").notNullable();
    });
  }

  if (!(await db.schema.hasTable("interactions"))) {
    await db.schema.createTable("interactions", (table) => {
      table.string("id", 64).primary();
      table.json("transaction").primary().notNullable();
      table.bigInteger("block_height").notNullable().index();
      table.string("block_id").notNullable();
      table.string("contract_id").notNullable().index();
      table.string("function").notNullable().index();
      table.json("input").notNullable();
      table.boolean("confirmed").notNullable().defaultTo(false);
    });
  }
}

// TODO: implement ;-)
function verifyConfirmations(context: Application.BaseContext) {
  return Promise.resolve(undefined);
}

export function blockListener(context: Application.BaseContext) {
  // not using setInterval on purpose -
  // https://developer.mozilla.org/en-US/docs/Web/API/setInterval#ensure_that_execution_duration_is_shorter_than_interval_frequency
  (function loop() {
    setTimeout(async function () {
      // Promise.race?
      await Promise.allSettled([
        doListenForBlocks(context),
        verifyConfirmations(context),
      ]);
      loop();
    }, INTERVAL_MS);
  })();
}

async function doListenForBlocks(context: Application.BaseContext) {
  const { db, arweave, logger } = context;
  logger.info("Searching for new block");

  // 1. find last processed block height and current Arweave network height
  const results: any[] = await Promise.allSettled([
    db("blocks").select("height").orderBy("height", "desc").limit(1).first(),
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

  const lastProcessedBlockHeight = results[0].value;
  const currentNetworkHeight = results[1].value.height;

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

  const blockInteractions = new Map<
    string,
    { height: number; interactions: GQLNodeInterface[] }
  >();

  // 3. map interactions into inserts into "blocks" and "interactions" tables
  const blockInserts: BLOCKS_TABLE[] = [];
  const interactionsInserts: INTERACTIONS_TABLE[] = [];

  interactions.forEach((interaction) => {
    const blockId = interaction.node.block.id;
    let contractId, input, functionName;

    if (!blockInteractions.has(blockId)) {
      blockInteractions.set(blockId, {
        height: interaction.node.block.height,
        interactions: [],
      });
    }
    blockInteractions.get(blockId)?.interactions.push(interaction.node);

    const contractTag = findTag(interaction, SmartWeaveTags.CONTRACT_TX_ID);
    const inputTag = findTag(interaction, SmartWeaveTags.INPUT);

    // Eyes Pop - Skin Explodes - Everybody Dead
    if (contractTag === undefined || inputTag === undefined) {
      context.logger.error(
        "Contract or input tag not found for interaction",
        interaction
      );
      return;
      // TODO: probably would be wise to save such stuff in a separate table
    } else {
      contractId = contractTag.value;
      input = inputTag.value;
      functionName = JSON.parse(input).function;
    }

    interactionsInserts.push({
      id: interaction.node.id,
      transaction: JSON.stringify(interaction.node),
      block_height: interaction.node.block.height,
      block_id: blockId,
      contract_id: contractId,
      function: functionName,
      input: input,
      confirmed: false,
    });
  });
  blockInteractions.forEach((value, key) => {
    blockInserts.push({
      id: key,
      transactions: JSON.stringify(value.interactions),
      height: value.height,
    });
  });

  // 4. finally inserting into DB
  logger.info(`Saving ${interactionsInserts.length} interactions`);
  await Promise.allSettled([
    db("blocks").insert(blockInserts),
    db("interactions").insert(interactionsInserts),
  ]);
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
