import Application from "koa";
import {TaskRunner} from "./TaskRunner";
import {MIN_CONFIRMATIONS} from "./verifyInteractions";

const ORPHANS_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 4;

export async function runVerifyOrphansTask(context: Application.BaseContext) {
  await TaskRunner
    .from("[orphans check]", verifyOrphans, context)
    .runAsyncEvery(ORPHANS_CHECK_INTERVAL_MS);
}

async function verifyOrphans(context: Application.BaseContext) {
  const {arweave, logger, gatewayDb} = context;

  let orphans: { id: string; }[];

  try {
    orphans = (await gatewayDb.raw(`
        SELECT interaction_id as id
        FROM interactions
        WHERE confirmation_status = 'orphaned';
    `)).rows;
  } catch (e: any) {
    logger.error('Error while checking orphaned transactions', e.message);
    return;
  }

  logger.debug(`Rechecking ${orphans.length} orphans`);

  for (const orphan of orphans) {
    try {
      const result = await arweave.transactions.getStatus(orphan.id);
      if (result.status !== 404
        && result
        && result.confirmed
        && result.confirmed.number_of_confirmations >= MIN_CONFIRMATIONS) {
        logger.warn(`Transaction ${orphan.id} is probably not orphaned, confirmations ${result.confirmed.number_of_confirmations}`);

        // returning transaction to "not_processed" pool.
        await gatewayDb("interactions")
          .where("interaction_id", orphan.id)
          .update({
            confirmation_status: 'not_processed',
            confirming_peer: null,
            confirmations: null
          });

      } else {
        logger.info(`Transaction ${orphan.id} confirmed as orphaned`);
      }
    } catch (e) {
      logger.error(`Error while orphan status ${orphan}`)
    }
  }


  logger.info("Orphans confirmation done.");
}
