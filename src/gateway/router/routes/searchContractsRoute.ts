import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function searchContractsRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  const {phrase} = ctx.params;

  if (phrase?.length < 3) {
    ctx.body = [];
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `SELECT contract_id
       FROM interactions
       WHERE contract_id ILIKE '${phrase}%'
       GROUP BY contract_id
       LIMIT 5;
      `
    );
    ctx.body = result?.rows;
    logger.debug("Contracts loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
