import {runLoadPeersTask} from "./tasks/loadPeers";
import {runVerifyInteractionsTask} from "./tasks/verifyInteractions";
import {runVerifyCorruptedTransactionsTask} from "./tasks/verifyCorruptedTransactions";
import {runSyncTransactionsTask} from "./tasks/syncTransactions";
import {GatewayContext} from "./init";


/**
 * Gateway consists of four separate tasks, each runs with its own interval:
 *
 * 1. peers tasks - checks the status (ie. "/info" endpoint) of all the peers returned by the arweave.net/peers.
 * If the given peer does not respond within MAX_ARWEAVE_PEER_INFO_TIMEOUT_MS - it is blacklisted 'till next round.
 * "Blocks", "height" from the response to "/info" and response times are being stored in the db - so that it would
 * be possible to rank peers be their "completeness" (ie. how many blocks do they store) and response times.
 *
 * 2. blocks sync task - listens for new blocks and loads the SmartWeave interaction transactions.
 *
 * 3. interactions verifier task - tries its best to confirm that transactions are not corrupted.
 * It takes the first PARALLEL_REQUESTS non confirmed transactions with block height lower then
 * current - MIN_CONFIRMATIONS.
 * For each set of the selected 'interactionsToCheck' transactions it makes
 * TX_CONFIRMATION_SUCCESSFUL_ROUNDS query rounds (to randomly selected at each round peers).
 * Only if we get TX_CONFIRMATION_SUCCESSFUL_ROUNDS within TX_CONFIRMATION_MAX_ROUNDS
 * AND response for the given transaction is the same for all the successful rounds
 * - the "confirmation" info for given transaction is updated in the the database.
 *
 * 4. corrupted transactions verifier task - additional task that double-verifies interactions marked as corrupted. If during the
 * re-check the interaction won't be recognized as corrupted - it is returned to the "not processed" pool.
 *
 * note: as there are very little fully synced nodes and they often timeout/504 - this process is a real pain...
 */
export async function runGateway(context: GatewayContext) {
  await runLoadPeersTask(context);

  await runSyncTransactionsTask(context);

  await runVerifyInteractionsTask(context)

  await runVerifyCorruptedTransactionsTask(context);
}
