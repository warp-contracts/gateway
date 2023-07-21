import Router from '@koa/router';
import {Benchmark} from 'warp-contracts';
import {isTxIdValid} from '../../../../utils';
import {GatewayError} from "../../../errorHandlerMiddleware";

export async function contractSourceRoute(ctx: Router.RouterContext) {
  const {logger, dbSource} = ctx;

  const {id} = ctx.query;

  if (!isTxIdValid(id as string)) {
    throw new GatewayError('Incorrect contract source transaction id.', 403);
  }

  const benchmark = Benchmark.measure();
  const result: any = await dbSource.raw(
    `
        SELECT s.src_tx_id                                                                         as "srcTxId",
               (case when not s.owner = 'error' then s.owner else null end)                        as "owner",
               s.src_content_type                                                                  as "srcContentType",
               (case when s.src_content_type = 'application/javascript' then s.src else null end)  as src,
               (case when s.src_content_type = 'application/wasm' then s.src_binary else null end) as "srcBinary",
               s.src_wasm_lang                                                                     as "srcWasmLang",
               s.bundler_src_tx_id                                                                 as "bundlerSrcTxId",
               s.src_tx                                                                            as "srcTx"
        FROM contracts_src s
        WHERE src_tx_id = ?
          AND src IS DISTINCT FROM 'error';
    `,
    [id]
  );

  if (!result?.rows[0]) {
    throw new GatewayError('Could not load contract source.', 400);
  } else {
    ctx.body = result?.rows[0];
  }

  logger.debug('Source loaded in', benchmark.elapsed());
}
