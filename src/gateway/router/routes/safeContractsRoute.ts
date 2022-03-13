import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function safeContractsRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT i.contract_id, count(i) AS interactions
          FROM contracts c
                   JOIN interactions i ON i.contract_id = c.contract_id
          WHERE 
              (c.src_content_type = 'application/javascript' 
                   AND (c.src NOT LIKE '%readContractState%' AND c.src NOT LIKE '%unsafeClient%'))
          OR c.src_content_type = 'application/wasm'
          GROUP BY i.contract_id
          HAVING count(i) < 20000 AND count(i) >= 1
          ORDER BY count(i) DESC;
      `
    );
    ctx.body = result?.rows;
    logger.debug("Safe contracts loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
