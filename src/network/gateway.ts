import {Knex} from "knex";
import Application from "koa";
import {
  Benchmark,
  GQLEdgeInterface,
  GQLResultInterface,
  GQLTagInterface,
  GQLTransactionsResultInterface,
  SmartWeaveTags,
} from "redstone-smartweave";
import {sleep} from "../utils";
import axios from "axios";

const MAX_GQL_REQUEST = 100;

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

type RoundResult = {
  txId: string;
  peer: string;
  result: string;
  confirmations: number;
}[];

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

const PARALLEL_REQUESTS = 10;

const TX_CONFIRMATION_SUCCESSFUL_ROUNDS = 3;

const TX_CONFIRMATION_MAX_ROUNDS = 4;

const TX_CONFIRMATION_MAX_ROUND_TIMEOUT_MS = 3000;

const CONFIRMATIONS_INTERVAL_MS = TX_CONFIRMATION_MAX_ROUND_TIMEOUT_MS * TX_CONFIRMATION_MAX_ROUNDS + 300;

const MAX_BATCH_INSERT_SQLITE = 500;

const MAX_ARWEAVE_PEER_INFO_TIMEOUT_MS = 3000;

const PEERS_CHECK_INTERVAL_MS = 1000 * 60 * 60;

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

export async function initGatewayDb(db: Knex) {
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
      table.boolean("blacklisted").notNullable().defaultTo("false");
    });
  }
}

/**
 * Gateway consists of three separate listeners, each runs with its own interval:
 *
 * 1. peers listener - checks the status (ie. "/info" endpoint) of all the peers returned by the arweave.net/peers.
 * If the given peer does not respond within MAX_ARWEAVE_PEER_INFO_TIMEOUT_MS - it is blacklisted 'till next round.
 * "Blocks", "height" from the response to "/info" and response times are being stored in the db - so that it would
 * be possible to rank peers be their "completeness" (ie. how many blocks do they store) and response times.
 *
 * 2. blocks listener - listens for new blocks and loads the SmartWeave interaction transactions.
 *
 * 3. interactions verifier - tries its best to confirm that transactions are not orphaned.
 * It takes the first PARALLEL_REQUESTS non confirmed transactions with block height lower then
 * current - MIN_CONFIRMATIONS.
 * For each set of the selected 'interactionsToCheck' transactions it makes
 * TX_CONFIRMATION_SUCCESSFUL_ROUNDS query rounds (to randomly selected at each round peers).
 * Only if we get TX_CONFIRMATION_SUCCESSFUL_ROUNDS within TX_CONFIRMATION_MAX_ROUNDS
 * AND response for the given transaction is the same for all the successful rounds
 * - the "confirmation" info for given transaction in updated in the the database.
 *
 * note: as there are very little fully synced nodes and they often timeout/504 - this process is a real pain...
 */
export async function gateway(context: Application.BaseContext) {
  (function peersCheckLoop() {
    setTimeout(async function () {
      // this operation takes quite a lot of time, so we're not blocking the rest of the node operation
      rankPeers(context)
        .then(() => {
          context.logger.info("Peers check complete");
        })
        .catch(r => {
          context.logger.error("Peers check failed", r.reason);
        });
      peersCheckLoop();
    }, PEERS_CHECK_INTERVAL_MS);
  })();

  await checkNewBlocks(context);
  (function blocksLoop() {
    // not using setInterval on purpose -
    // https://developer.mozilla.org/en-US/docs/Web/API/setInterval#ensure_that_execution_duration_is_shorter_than_interval_frequency
    setTimeout(async function () {
      await checkNewBlocks(context);
      blocksLoop();
    }, BLOCKS_INTERVAL_MS);
  })();

  await verifyConfirmations(context);
  (function confirmationsLoop() {
    setTimeout(async function () {
      await verifyConfirmations(context);
      confirmationsLoop();
    }, CONFIRMATIONS_INTERVAL_MS);
  })();
}

async function rankPeers(context: Application.BaseContext) {
  const {gatewayLogger: logger, arweave, gatewayDb} = context;

  let peers = [];
  try {
    peers = await arweave.network.getPeers();
  } catch (e) {
    logger.error("Error from Arweave while loading peers", e);
    return;
  }

  for (const peer of peers) {
    logger.debug(`Checking Arweave peer ${peer}`);
    try {
      const benchmark = Benchmark.measure();
      const result = await axios.get(`http://${peer}/info`, {
        timeout: MAX_ARWEAVE_PEER_INFO_TIMEOUT_MS
      });
      const elapsed = benchmark.elapsed(true);

      await gatewayDb("peers")
        .insert({
          peer: peer,
          blocks: result.data.blocks,
          height: result.data.height,
          response_time: elapsed,
          blacklisted: false,
        })
        .onConflict(["peer"])
        .merge();
    } catch (e: any) {
      logger.error(`Error from ${peer}`, e.message);
      await gatewayDb("peers")
        .insert({
          peer: peer,
          blocks: 0,
          height: 0,
          response_time: 0,
          blacklisted: true,
        })
        .onConflict(["peer"])
        .merge();
    }
  }
}

async function verifyConfirmations(context: Application.BaseContext) {
  const {arweave, gatewayLogger: logger, gatewayDb} = context;

  let currentNetworkHeight;
  try {
    currentNetworkHeight = (await arweave.network.getInfo()).height;
  } catch (e: any) {
    logger.error("Error from Arweave", e.message);
    return;
  }

  const safeNetworkHeight = currentNetworkHeight - MIN_CONFIRMATIONS;
  logger.debug("Verify confirmations params:", {
    currentNetworkHeight,
    safeNetworkHeight,
  });

  // note: as the "status" endpoint for arweave.net currently returns 504 - Bad Gateway for orphaned transactions,
  // we need to ask peers directly...
  // https://discord.com/channels/357957786904166400/812013044892172319/917819482787958806
  // only 7 nodes are currently fully synced, duh...
  const peers: { peer: string }[] = await gatewayDb.raw(`
      SELECT peer
      FROM peers
      WHERE height > 0
        AND blacklisted = false
      ORDER BY height - blocks ASC, response_time ASC
          LIMIT ${PARALLEL_REQUESTS};
  `);


  // note:
  // 1. excluding Kyve contracts, as they moved to Moonbeam (and their contracts have the most interactions)
  // 2. excluding Koi contracts (well, those with the most interactions, as there are dozens of Koi contracts)
  // - as they're using their own infrastructure and probably won't be interested in using this solution.
  const interactionsToCheck: { block_height: number; id: string }[] =
    await gatewayDb.raw(
      `
          SELECT block_height, id
          FROM interactions
          WHERE block_height < (SELECT max(block_height) FROM interactions) - ?
            AND confirmation_status = 'not_processed'
            AND contract_id NOT IN (
                                    "LkfzZvdl_vfjRXZOPjnov18cGnnK3aDKj0qSQCgkCX8", /* kyve  */
                                    "l6S4oMyzw_rggjt4yt4LrnRmggHQ2CdM1hna2MK4o_c", /* kyve  */
                                    "B1SRLyFzWJjeA0ywW41Qu1j7ZpBLHsXSSrWLrT3ebd8", /* kyve  */
                                    "cETTyJQYxJLVQ6nC3VxzsZf1x2-6TW2LFkGZa91gUWc", /* koi   */
                                    "QA7AIFVx1KBBmzC7WUNhJbDsHlSJArUT0jWrhZMZPS8", /* koi   */
                                    "8cq1wbjWHNiPg7GwYpoDT2m9HX99LY7tklRQWfh1L6c", /* kyve  */
                                    "NwaSMGCdz6Yu5vNjlMtCNBmfEkjYfT-dfYkbQQDGn5s", /* koi   */
                                    "qzVAzvhwr1JFTPE8lIU9ZG_fuihOmBr7ewZFcT3lIUc", /* koi   */
                                    "OFD4GqQcqp-Y_Iqh8DN_0s3a_68oMvvnekeOEu_a45I", /* kyve  */
                                    "CdPAQNONoR83Shj3CbI_9seC-LqgI1oLaRJhSwP90-o", /* koi   */
                                    "dNXaqE_eATp2SRvyFjydcIPHbsXAe9UT-Fktcqs7MDk" /* kyve  */
              )
          ORDER BY block_height DESC LIMIT ?;`,
      [MIN_CONFIRMATIONS, PARALLEL_REQUESTS]
    );

  if (interactionsToCheck.length === 0) {
    logger.info("No new interactions to confirm.");
    return;
  }

  logger.debug(`Checking ${interactionsToCheck.length} interactions.`);

  let statusesRounds: RoundResult[] = Array<RoundResult>(TX_CONFIRMATION_SUCCESSFUL_ROUNDS);
  let successfulRounds = 0;
  let rounds = 0;

  // we need to make sure that each interaction in each round will be checked by a different peer.
  // - that's why we keep the peers registry per interaction
  const interactionsPeers = new Map<string, { peer: string }[]>();
  interactionsToCheck.forEach(i => {
    interactionsPeers.set(i.id, [...peers]);
  });

  // at some point we could probably generify the snowball and use it here to ask multiple peers.
  while (successfulRounds < TX_CONFIRMATION_SUCCESSFUL_ROUNDS && rounds < TX_CONFIRMATION_MAX_ROUNDS) {

    // too many rounds have already failed and there's no chance to get the minimal successful rounds...
    if (successfulRounds + TX_CONFIRMATION_MAX_ROUNDS - rounds < TX_CONFIRMATION_SUCCESSFUL_ROUNDS) {
      logger.warn("There's no point in trying, exiting..");
      return;
    }

    try {
      const roundResult: {
        txId: string;
        peer: string;
        result: string;
        confirmations: number;
      }[] = [];

      // checking status of each of the interaction by a randomly selected peer.
      // in each round each interaction will be checked by a different peer.
      const statuses = await Promise.race([
        new Promise<any[]>(function (resolve, reject) {
          setTimeout(
            () => reject("Status query timeout, better luck next time..."),
            TX_CONFIRMATION_MAX_ROUND_TIMEOUT_MS
          );
        }),

        Promise.allSettled(
          interactionsToCheck.map((tx) => {
            const interactionPeers = interactionsPeers.get(tx.id)!;
            logger.trace("Interaction peers before", {
              interaction: tx.id,
              length: interactionPeers.length,
              peers: interactionPeers,
            })
            const randomPeer = interactionPeers[Math.floor(Math.random() * interactionPeers.length)];

            // removing the selected peer for this interaction
            // - so it won't be selected again in any of the next rounds.
            interactionPeers.splice(peers.indexOf(randomPeer), 1);
            const randomPeerUrl = `http://${randomPeer.peer}`;
            logger.debug(`[${tx.id}]: ${randomPeerUrl}`);
            logger.trace("Interaction peers after", {
              interaction: tx.id,
              randomPeer,
              length: interactionsPeers.get(tx.id)!.length,
              peers: interactionsPeers.get(tx.id)!
            })

            return axios.get(`${randomPeerUrl}/tx/${tx.id}/status`);
          })
        )
      ]);

      // verifying responses from peers
      for (let i = 0; i < statuses.length; i++) {
        const statusResponse = statuses[i];
        if (statusResponse.status === "rejected") {
          // interaction is (probably) orphaned
          if (statusResponse.reason.response?.status === 404) {
            logger.warn(`Interaction ${interactionsToCheck[i].id} on ${statusResponse.reason.request.host} not found.`);
            roundResult.push({
              txId: interactionsToCheck[i].id,
              peer: statusResponse.reason.request.host,
              result: "orphaned",
              confirmations: 0,
            });
          } else {
            // no proper response from peer (eg. 500)
            // TODO: consider blacklisting such peer (after returning error X times?) 'till next peersCheckLoop
            logger.error(`Query for ${interactionsToCheck[i].id} to ${statusResponse.reason?.request?.host} rejected. ${statusResponse.reason}.`);
            roundResult.push({
              txId: interactionsToCheck[i].id,
              peer: statusResponse.reason?.request?.host,
              result: "error",
              confirmations: 0,
            });
          }
        } else {
          // transaction confirmed by given peer
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
      `Transactions verification was not successful, successful rounds ${successfulRounds}, required successful rounds ${TX_CONFIRMATION_SUCCESSFUL_ROUNDS}`);
  } else {
    logger.info("Verifying rounds");

    // sanity check...whether all rounds have the same amount of interactions checked.
    for (let i = 0; i < statusesRounds.length; i++) {
      const r = statusesRounds[i];
      if (r.length !== interactionsToCheck.length) {
        logger.error(`Each round should have ${interactionsToCheck.length} results. Round ${i} has ${r.length}.`);
        return;
      }
    }

    // programming is just loops and if-s...
    // For each interaction we're verifying whether the result returned in each round is the same.
    // If it is the same for all rounds - we store the confirmation status in the db.
    // It it is not the same - we're logging the difference and move to the next interaction.
    for (let i = 0; i < interactionsToCheck.length; i++) {
      let status = null;
      let sameStatusOccurrence = 0;
      const confirmingPeers = [];
      const confirmations = [];

      for (let j = 0; j < TX_CONFIRMATION_SUCCESSFUL_ROUNDS; j++) {
        const newStatus = statusesRounds[j][i].result;
        if (status === null || newStatus === status) {
          status = newStatus;
          sameStatusOccurrence++;
          confirmingPeers.push(statusesRounds[j][i].peer);
          confirmations.push(statusesRounds[j][i].confirmations);
        } else {
          logger.warn("Different response from peers for", {
            current_peer: statusesRounds[j][i],
            prev_peer: statusesRounds[j - 1][i]
          });
          break;
        }
      }

      if (sameStatusOccurrence === TX_CONFIRMATION_SUCCESSFUL_ROUNDS) {
        // sanity check...
        if (status === null) {
          logger.error("WTF? Status should not be null!");
          continue;
        }
        try {
          await gatewayDb("interactions")
            .where("id", interactionsToCheck[i].id)
            .update({
              confirmation_status: status,
              confirming_peer: confirmingPeers.join(","),
              confirmations: confirmations.join(","),
            });
        } catch (e) {
          logger.error(e);
        }
      }
    }
  }

  logger.info("Transactions confirmation done.");
}

async function checkNewBlocks(context: Application.BaseContext) {
  const {gatewayDb, arweave, gatewayLogger: logger} = context;
  logger.info("Searching for new blocks");

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
    logger.error("Error while processing next block", rejections.map((r) => r.reason));
    return;
  }

  const currentNetworkHeight = results[1].value.height;
  const lastProcessedBlockHeight = results[0].value["block_height"];

  logger.debug("Network info", {
    currentNetworkHeight,
    lastProcessedBlockHeight,
  });

  if (lastProcessedBlockHeight === currentNetworkHeight) {
    logger.info("No new blocks, nothing to do...");
    return;
  }

  // 2. load interactions [last processed block + 1, currentNetworkHeight]
  let interactions: GQLEdgeInterface[]
  try {
    interactions = await load(
      context,
      lastProcessedBlockHeight + 1,
      currentNetworkHeight
    );
  } catch (e: any) {
    logger.error("Error while loading interactions", e.message);
    return;
  }

  if (interactions.length === 0) {
    logger.info("Now new interactions");
    return;
  }

  logger.info(`Found ${interactions.length} new interactions`);

  // 3. map interactions into inserts to "interactions" table
  let interactionsInserts: INTERACTIONS_TABLE[] = [];

  for (let i = 0; i < interactions.length; i++) {
    const interaction = interactions[i];
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

    if (interactionsInserts.find((i) => i.id === interaction.node.id) !== undefined) {
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

    if (interactionsInserts.length === MAX_BATCH_INSERT_SQLITE) {
      try {
        logger.info(`Batch insert ${MAX_BATCH_INSERT_SQLITE} interactions.`);
        const interactionsInsertResult = await gatewayDb("interactions").insert(interactionsInserts);
        logger.debug("interactionsInsertResult", interactionsInsertResult);
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
      const interactionsInsertResult = await gatewayDb("interactions").insert(interactionsInserts);
      logger.debug("interactionsInsertResult", interactionsInsertResult);
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
