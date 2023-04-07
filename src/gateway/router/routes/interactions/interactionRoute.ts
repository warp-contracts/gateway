import Router from '@koa/router';
import {Benchmark} from 'warp-contracts';
import {GatewayError} from "../../../errorHandlerMiddleware";

export async function interactionRoute(ctx: Router.RouterContext) {
  const {logger, dbSource} = ctx;

  const {id} = ctx.params;

  if (id?.length != 43) {
    throw new GatewayError('Incorrect contract source transaction id.', 403);
  }

  const benchmark = Benchmark.measure();
  const result: any = await dbSource.raw(
    `
        SELECT interaction_id      as interactionId,
               bundler_tx_id       as bundlerTxId,
               interaction         as interaction,
               block_height        as blockHeight,
               block_id            as blockId,
               contract_id         as contractId,
               function            as function,
               input               as input,
               confirmation_status as confirmationStatus,
               confirming_peer     as confirmingPeer,
               confirmed_at_height as confirmedAtHeight,
               confirmations       as confirmations,
               sort_key            as sortKey
        FROM interactions
        WHERE interaction_id = ?;
    `,
    [id]
  );
  ctx.body = result?.rows[0];
  logger.debug('Contract data loaded in', benchmark.elapsed());
}
