import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function interactionsRoute(ctx: Router.RouterContext) {
  const {gatewayLogger: logger, gatewayDb} = ctx;

  logger.debug("query", ctx.query);

  const {contractId, from, to} = ctx.query;

  logger.debug("Interactions route", {
    contractId,
    from,
    to,
  });

  const bindings: any[] = [];
  bindings.push(contractId);
  from && bindings.push(from as string);
  to && bindings.push(to as string);

  try {
    const benchmark = Benchmark.measure();
    const rows: any[] = await gatewayDb.raw(
      `
          SELECT "transaction"
          FROM interactions
          WHERE contract_id = ? ${from ? ' AND block_height >= ?' : ''} ${to ? ' AND block_height <= ?' : ''}
          ORDER BY block_height ASC;
      `, bindings
    );
    logger.debug("Interactions loaded in", benchmark.elapsed());
    ctx.body = rows;
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
