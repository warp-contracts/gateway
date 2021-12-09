import Router from "@koa/router";

export async function contractsRoute(ctx: Router.RouterContext) {
  const {gatewayLogger: logger, gatewayDb} = ctx;

  const {nodeId, address} = ctx.request.body as {
    nodeId: string;
    address: string;
  };

  logger.debug("Contracts route", {
    nodeId,
    address,
  });

  try {
    const rows: any[] = await gatewayDb.raw(
      `
          SELECT contract_id                                                                  AS contract,
                 count("transaction")                                                         AS interactions,
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
  }
  catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
