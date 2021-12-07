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
import axios from "axios";

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
const BLOCKS_INTERVAL_MS = 90 * 1000;

const GQL_RETRY_MS = 30 * 1000;

const MIN_CONFIRMATIONS = 10;

const PARALLEL_REQUESTS = 20;

const TX_CONFIRMATION_SUCCESSFUL_ROUNDS = 3;

const TX_CONFIRMATION_MAX_ROUNDS = 5;

const TX_CONFIRMATION_MAX_ROUND_TIMEOUT_MS = 3000;

const CONFIRMATIONS_INTERVAL_MS =
  TX_CONFIRMATION_MAX_ROUND_TIMEOUT_MS * TX_CONFIRMATION_MAX_ROUNDS + 2000;

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
        // not_processed | orphaned | confirmed | error
        .defaultTo("not_processed");
      table.string("confirming_peer");
      table.bigInteger("confirmed_at_height");
      table.bigInteger("confirmations");
    });
  }

  if (!(await db.schema.hasTable("peers"))) {
    await db.schema.createTable("peers", (table) => {
      table.string("peer", 64).primary();
      table.bigInteger("blocks").notNullable();
      table.bigInteger("height").notNullable();
      table.bigInteger("response_time").notNullable();
    });
  }
}

export async function blockListener(context: Application.BaseContext) {
  // TODO: this should be called every now and then...
  // await rankPeers(context);
  /*await checkNewBlocks(context);
  (function blocksLoop() {
    // not using setInterval on purpose -
    // https://developer.mozilla.org/en-US/docs/Web/API/setInterval#ensure_that_execution_duration_is_shorter_than_interval_frequency
    setTimeout(async function () {
      await checkNewBlocks(context);
      blocksLoop();
    }, BLOCKS_INTERVAL_MS);
  })();*/
  await verifyConfirmations(context);
  (function confirmationsLoop() {
      setTimeout(async function () {
        await verifyConfirmations(context);
        confirmationsLoop();
      }, CONFIRMATIONS_INTERVAL_MS);
    })();
}

async function rankPeers(context: Application.BaseContext) {
  const { logger, arweave, blocksDb } = context;
  const peers = await arweave.network.getPeers();

  for (const peer of peers) {
    logger.debug(`checking ${peer}`);
    try {
      const benchmark = Benchmark.measure();
      const result = await axios.get(`http://${peer}/info`);
      const elapsed = benchmark.elapsed(true);

      await blocksDb("peers")
        .insert({
          peer: peer,
          blocks: result.data.blocks,
          height: result.data.height,
          response_time: elapsed,
        })
        .onConflict(["peer"])
        .merge();
    } catch (e) {
      logger.error(`Error from ${peer}`, e);
    }
  }
}

async function verifyConfirmations(context: Application.BaseContext) {
  const { arweave, logger, blocksDb } = context;

  //FIXME: {@link checkNewBlocks) makes the same call...
  const currentNetworkHeight = (await arweave.network.getInfo()).height;

  const safeNetworkHeight = currentNetworkHeight - MIN_CONFIRMATIONS;
  logger.info("Verify confirmations params:", {
    currentNetworkHeight,
    safeNetworkHeight,
  });

  // note: as the "status" endpoint for arweave.net currently returns 504 - Bad Gateway for orphaned transactions,
  // we need to ask peers directly...
  // https://discord.com/channels/357957786904166400/812013044892172319/917819482787958806
  // only 7 nodes are currently fully synced, duh...
  const peers = await blocksDb.raw(`
    SELECT peer FROM peers
    WHERE height > 0
    ORDER BY height - blocks ASC, response_time ASC
    LIMIT 10;
  `);

  const interactionsToCheck: { block_height: number; id: string }[] =
    await blocksDb.raw(
      `
    SELECT block_height, id FROM interactions
    WHERE block_height < (SELECT max(block_height) FROM interactions) - ?
    AND confirmation_status = 'not_processed'
    ORDER BY block_height DESC LIMIT ?;`,
      [MIN_CONFIRMATIONS, PARALLEL_REQUESTS]
    );

  // logger.debug(interactions);

  type RoundResult = {
    txId: string;
    peer: string;
    result: string;
    confirmations: number;
  }[];

  let statusesRounds: RoundResult[] = Array<RoundResult>(
    TX_CONFIRMATION_SUCCESSFUL_ROUNDS
  );
  let successfulRounds = 0;
  let rounds = 0;

  // at some point we could probably generify snowball and use it here to ask multiple peers.
  // 'till then - for each set of the selected 'interactionsToCheck' transactions we're making
  // TX_CONFIRMATION_SUCCESSFUL_ROUNDS query rounds (to randomly selected at each round peers).
  // Only if we get TX_CONFIRMATION_SUCCESSFUL_ROUNDS within TX_CONFIRMATION_MAX_ROUNDS
  // AND response for the given transaction is the same for all the rounds - we're updating "confirmation"
  // info for this transaction in the database.
  while (
    successfulRounds < TX_CONFIRMATION_SUCCESSFUL_ROUNDS &&
    rounds < TX_CONFIRMATION_MAX_ROUNDS
  ) {
    if (
      successfulRounds + TX_CONFIRMATION_MAX_ROUNDS - rounds <
      TX_CONFIRMATION_SUCCESSFUL_ROUNDS
    ) {
      logger.warn("There's no point in trying, exiting..");
      break;
    }

    try {
      const roundResult: {
        txId: string;
        peer: string;
        result: string;
        confirmations: number;
      }[] = [];

      const statuses = await Promise.race([
        new Promise<any[]>(function (resolve, reject) {
          setTimeout(
            () => reject("Status query timeout, better luck next time..."),
            TX_CONFIRMATION_MAX_ROUND_TIMEOUT_MS
          );
        }),

        Promise.allSettled(
          interactionsToCheck.map((tx) => {
            const randomPeer = peers[Math.floor(Math.random() * peers.length)];
            const randomPeerUrl = `http://${randomPeer.peer}/`;
            return axios.get(`${randomPeerUrl}/tx/${tx.id}/status`);
          })
        ),
      ]);
      for (let i = 0; i < statuses.length; i++) {
        const statusResponse = statuses[i];
        if (statusResponse.status === "rejected") {
          if (
            statusResponse.reason.response?.status === 404 &&
            statusResponse.reason.response?.data === "Not Found."
          ) {
            logger.warn(
              `Interaction ${interactionsToCheck[i].id} on ${statusResponse.reason.request.host} not found.`
            );
            roundResult.push({
              txId: interactionsToCheck[i].id,
              peer: statusResponse.reason.request.host,
              result: "orphaned",
              confirmations: 0,
            });
          } else {
            logger.error(
              `Query for ${interactionsToCheck[i].id} to ${statusResponse.reason?.request?.host} rejected. ${statusResponse.reason}.`
            );
            roundResult.push({
              txId: interactionsToCheck[i].id,
              peer: statusResponse.reason?.request?.host,
              result: "error",
              confirmations: 0,
            });
          }
        } else {
          /*logger.debug(
            `Result from ${statusResponse.value.request.host}`,
            statusResponse.value.data
          );*/

          roundResult.push({
            txId: interactionsToCheck[i].id,
            peer: statusResponse.value.request.host,
            result: "confirmed",
            confirmations: statusResponse.value.data["number_of_confirmations"],
          });
        }
      }
      statusesRounds[successfulRounds] = roundResult;
      successfulRounds++;
    } catch (e) {
      logger.error(e);
    } finally {
      rounds++;
    }
  }

  if (successfulRounds != TX_CONFIRMATION_SUCCESSFUL_ROUNDS) {
    logger.warn(
      `Transactions verification was not successful, successful rounds ${successfulRounds},
      required successful rounds ${TX_CONFIRMATION_SUCCESSFUL_ROUNDS}`
    );
  } else {
    logger.info("Verifying rounds");

    // sanity check...
    for (let i = 0; i < statusesRounds.length; i++) {
      const r = statusesRounds[i];
      if (r.length !== PARALLEL_REQUESTS) {
        logger.error(
          `Each round should have ${PARALLEL_REQUESTS} results. Round ${i} has ${r.length}.`
        );
        return;
      }
    }

    // programming is just loops and if-s...
    for (let i = 0; i < interactionsToCheck.length; i++) {
      let status = null;
      let sameStatus = 0;
      const peers = [];
      const confirmations = [];

      for (let j = 0; j < TX_CONFIRMATION_SUCCESSFUL_ROUNDS; j++) {
        const newStatus = statusesRounds[j][i].result;
        if (status === null || newStatus === status) {
          status = newStatus;
          sameStatus++;
          peers.push(statusesRounds[j][i].peer);
          confirmations.push(statusesRounds[j][i].confirmations);
        } else {
          logger.warn("Different response from peers for", {
            interaction: interactionsToCheck[i],
            current_peer: statusesRounds[j][i],
            prev_peer: statusesRounds[j - 1][i],
          });
          break;
        }
      }

      if (sameStatus === TX_CONFIRMATION_SUCCESSFUL_ROUNDS) {
        // sanity check...
        if (status === null) {
          logger.error("WTF? Status should not be null!");
          continue;
        }
        logger.debug("Updating status in DB");
        try {
          await blocksDb("interactions")
            .where("id", interactionsToCheck[i].id)
            .update({
              confirmation_status: status,
              confirming_peer: peers.join(","),
              confirmations: confirmations.join(","),
            });
        } catch (e) {
          logger.error(e);
        }
      }
    }
  }

  logger.debug("Done processing");
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
