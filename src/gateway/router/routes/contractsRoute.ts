import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

const MAX_CONTRACTS_PER_PAGE = 100;

export async function contractsRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  const {type, page, limit} = ctx.query;

  logger.debug("Contracts route", {type, page, limit});

  const parsedPage = page ? parseInt(page as string) : 1;
  const parsedLimit = limit ? Math.min(parseInt(limit as string), MAX_CONTRACTS_PER_PAGE) : MAX_CONTRACTS_PER_PAGE;
  const offset = parsedPage ? (parsedPage - 1) * parsedLimit : 0;

  const bindings: any[] = [];
  type && bindings.push(type);
  parsedPage && bindings.push(parsedLimit);
  parsedPage && bindings.push(offset);

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT i.contract_id                                                             AS contract,
                 c.owner                                                                   AS owner,
                 c.type                                                                    AS type,
                 case when c.type = 'pst' then c.init_state->>'ticker' else null end       AS token,
                 count(*)                                                                  AS interactions,
                 count(case when i.confirmation_status = 'corrupted' then 1 else null end) AS corrupted,
                 count(case when i.confirmation_status = 'confirmed' then 1 else null end) AS confirmed,
                 max(i.block_height)                                                       AS last_interaction_height,
                 count(*) OVER ()                                                          AS total
          FROM interactions i
                   LEFT JOIN contracts c
                             ON c.contract_id = i.contract_id
          WHERE i.contract_id != '' AND c.type != 'error' ${type ? 'AND c.type = ?' : ''}
          GROUP BY i.contract_id, c.owner, c.type, c.init_state
          ORDER BY last_interaction_height DESC, interactions DESC ${parsedPage ? ' LIMIT ? OFFSET ?' : ''};
      `, bindings
    );

    const total = result?.rows?.length > 0 ? parseInt(result.rows[0].total) : 0;
    ctx.body = {
      paging: {
        total,
        limit: parsedLimit,
        items: result?.rows.length,
        page: parsedPage,
        pages: Math.ceil(total / parsedLimit)
      },
      contracts: result?.rows
    };
    logger.debug("Contracts loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
