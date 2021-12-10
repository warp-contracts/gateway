import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

const CONTRACTS_PER_PAGE = 100;

export async function contractsRoute(ctx: Router.RouterContext) {
  const {gatewayLogger: logger, gatewayDb} = ctx;

  logger.debug("Contracts route");

  const {page} = ctx.query;

  const parsedPage = page ? parseInt(page as string) : 1;
  const offset = parsedPage ? (parsedPage - 1) * CONTRACTS_PER_PAGE : 0;

  const bindings: any[] = [];
  parsedPage && bindings.push(CONTRACTS_PER_PAGE);
  parsedPage && bindings.push(offset);

  try {
    const benchmark = Benchmark.measure();
    const rows: any[] = await gatewayDb.raw(
      `
          SELECT contract_id                                                                  AS contract,
                 count(interaction)                                                           AS interactions,
                 count(case when confirmation_status != "not_processed" then 1 else null end) AS verifications,
                 count(case when confirmation_status == "orphaned" then 1 else null end)      AS orphaned,
                 count(case when confirmation_status == "confirmed" then 1 else null end)     AS confirmed,
                 max(block_height)                                                            AS last_interaction_height,
                 count(*) OVER ()                                                             AS total
          FROM interactions
          WHERE contract_id != ''
          GROUP BY contract_id
          ORDER BY last_interaction_height DESC, interactions DESC ${parsedPage ? ' LIMIT ? OFFSET ?' : ''};
      `, bindings
    );
    const total = rows?.length > 0 ? rows[0].total : 0;
    ctx.body = {
      paging: {
        total,
        limit: CONTRACTS_PER_PAGE,
        items: rows?.length,
        page: parsedPage,
        pages: Math.ceil(total / CONTRACTS_PER_PAGE)
      },
      contracts: rows
    };
    logger.debug("Contracts loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
