import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function statsTagsRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
            SELECT tg.value as "Content-Type", count(tg.value) as amount
                FROM contracts c
                JOIN tags tg on tg.contract_id = c.contract_id
            WHERE tg.name = 'Content-Type'
            GROUP BY tg.value
            ORDER BY count(tg.value) desc;
      `
    );
    ctx.body = result?.rows;
    logger.debug("Contracts stats loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
