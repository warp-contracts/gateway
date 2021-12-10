import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function contractsRoute(ctx: Router.RouterContext) {
  const {gatewayLogger: logger, gatewayDb} = ctx;

  logger.debug("Contracts route")

  try {
    const benchmark = Benchmark.measure();
    const rows: any[] = await gatewayDb.raw(
      `
          SELECT contract_id                                                                  AS contract,
                 count(interaction)                                                           AS interactions,
                 count(case when confirmation_status != "not_processed" then 1 else null end) AS verifications,
                 count(case when confirmation_status == "orphaned" then 1 else null end)      AS orphaned,
                 count(case when confirmation_status == "confirmed" then 1 else null end)     AS confirmed,
                 max(block_height)                                                            AS last_interaction_height
          FROM interactions
          WHERE contract_id != ''
          GROUP BY contract_id
          ORDER BY last_interaction_height DESC, interactions DESC;
      `
    );
    ctx.body = rows;
    logger.debug("Contracts loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
