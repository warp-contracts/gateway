import {Knex} from "knex";
import Application from "koa";
import {runLoadPeersTask} from "./tasks/loadPeers";
import {runSyncBlocksTask} from "./tasks/syncBlocks";
import {runVerifyInteractionsTask} from "./tasks/verifyInteractions";

// TODO: I would move the `initGatewayDb` to a seaparate module (e.g. schemas.ts or db.ts)
// along with the `INTERACTIONS_TABLE` type
export type INTERACTIONS_TABLE = {
  interaction_id: string;
  interaction: string;
  block_height: number;
  block_id: string;
  contract_id: string;
  function: string;
  input: string;
  confirmation_status: string;
};

export async function initGatewayDb(db: Knex) {
  if (!(await db.schema.hasTable("interactions"))) {
    await db.schema.createTable("interactions", (table) => {
      table.increments("id").primary();
      table.string("interaction_id", 64).notNullable().index();
      table.json("interaction").notNullable();
      table.bigInteger("block_height").notNullable().index();
      table.string("block_id").notNullable();
      table.string("contract_id").notNullable().index();
      table.string("function").index();
      table.jsonb("input").notNullable();
      table
        .string("confirmation_status")
        .index()
        .notNullable()
        // not_processed | orphaned | confirmed
        .defaultTo("not_processed");
      table.string("confirming_peer");
      table.bigInteger("confirmed_at_height");
      table.bigInteger("confirmations");
      table.index(['contract_id', 'block_height'], 'contract_id_block_height_index');
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
 * Gateway consists of three separate tasks, each runs with its own interval:
 *
 * 1. peers tasks - checks the status (ie. "/info" endpoint) of all the peers returned by the arweave.net/peers.
 * If the given peer does not respond within MAX_ARWEAVE_PEER_INFO_TIMEOUT_MS - it is blacklisted 'till next round.
 * "Blocks", "height" from the response to "/info" and response times are being stored in the db - so that it would
 * be possible to rank peers be their "completeness" (ie. how many blocks do they store) and response times.
 *
 * 2. blocks sync task - listens for new blocks and loads the SmartWeave interaction transactions.
 *
 * 3. interactions verifier task - tries its best to confirm that transactions are not orphaned.
 * It takes the first PARALLEL_REQUESTS non confirmed transactions with block height lower then
 * current - MIN_CONFIRMATIONS.
 * For each set of the selected 'interactionsToCheck' transactions it makes
 * TX_CONFIRMATION_SUCCESSFUL_ROUNDS query rounds (to randomly selected at each round peers).
 * Only if we get TX_CONFIRMATION_SUCCESSFUL_ROUNDS within TX_CONFIRMATION_MAX_ROUNDS
 * AND response for the given transaction is the same for all the successful rounds
 * - the "confirmation" info for given transaction in (in -> is?) updated in the the database.
 *
 * note: as there are very little fully synced nodes and they often timeout/504 - this process is a real pain...
 */
export async function runGateway(context: Application.BaseContext) {
  await runLoadPeersTask(context);

  await runSyncBlocksTask(context);

  await runVerifyInteractionsTask(context)
}
