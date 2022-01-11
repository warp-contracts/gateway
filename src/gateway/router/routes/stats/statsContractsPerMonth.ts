import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function statsContractsPerMonthRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          WITH contracts_per_month AS (
              SELECT to_timestamp(timestamp::integer) as date, contract_id as contract
              FROM stats
          )
          SELECT DATE_TRUNC('month', date) AS  contracts_to_month,
                 COUNT(contract) AS count
          FROM contracts_per_month
          GROUP BY DATE_TRUNC('month', date)
          ORDER BY DATE_TRUNC('month', date) ASC;
      `
    );
    ctx.body = result?.rows;
    logger.debug("Stats loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
