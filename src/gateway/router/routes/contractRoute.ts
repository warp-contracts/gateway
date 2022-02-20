import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function contractRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  const {id} = ctx.params;

  if (id?.length != 43) {
    ctx.body = {};
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT contract_id                                                                     as "txId",
                 src_tx_id                                                                       as "srcTxId",
                 (case when src_content_type = 'application/javascript' then src else null end)  as src,
                 (case when src_content_type = 'application/wasm' then src_binary else null end) as "srcBinary",
                 init_state                                                                      as "initState",
                 owner                                                                           as "owner",
                 pst_ticker                                                                      as "pstTicker",
                 pst_name                                                                        as "pstName",
                 src_wasm_lang                                                                   as "srcWasmLang"
          FROM contracts
          WHERE contract_id = ?;
      `, [id]
    );
    ctx.body = result?.rows[0];
    logger.debug("Contract data loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
