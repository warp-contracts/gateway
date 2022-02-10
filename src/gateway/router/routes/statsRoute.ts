import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function statsRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  const {phrase} = ctx.params;

  if (phrase?.length < 3) {
    ctx.body = {};
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT count(i.id) as total
          FROM interactions i
          UNION ALL
          SELECT count(c.contract_id) as total
          FROM contracts c;
      `
    );
    ctx.body = {
      total_contracts: result?.rows[0].total,
      total_interactions: result?.rows[1].total
    }

    logger.debug("Stats loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
