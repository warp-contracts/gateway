import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function interactionsRoute(ctx: Router.RouterContext) {
  const {gatewayLogger: logger, gatewayDb} = ctx;

  logger.debug("query", ctx.query);

  const {contractId, from, to} = ctx.query;

  logger.debug("Contracts route", {
    contractId,
    from,
    to,
  });

  try {
    const benchmark = Benchmark.measure();
    const rows: any[] = await gatewayDb.raw(
      `
          SELECT "transaction"
          FROM interactions
          WHERE contract_id = ?;
      `, [contractId as string]
    );
    logger.debug("Interactions loaded in", benchmark.elapsed());
    ctx.body = rows;
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
