import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

const INTERACTIONS_PER_PAGE = 2000;

export async function interactionsRoute(ctx: Router.RouterContext) {
  const {gatewayLogger: logger, gatewayDb} = ctx;

  const {contractId, confirmationStatus, page, from, to} = ctx.query;

  logger.debug("Interactions route", {
    contractId,
    confirmationStatus,
    page,
    from,
    to
  });

  const parsedPage = page ? parseInt(page as string) : undefined;
  const offset = parsedPage ? (parsedPage - 1) * INTERACTIONS_PER_PAGE : 0;

  const bindings: any[] = [];
  bindings.push(contractId);
  from && bindings.push(from as string);
  to && bindings.push(to as string);
  confirmationStatus && bindings.push(confirmationStatus)
  parsedPage && bindings.push(INTERACTIONS_PER_PAGE);
  parsedPage && bindings.push(offset);

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT interaction, confirmation_status, confirming_peer, confirmations, count(*) OVER () AS total
          FROM interactions
          WHERE contract_id = ? ${from ? ' AND block_height >= ?' : ''} ${to ? ' AND block_height <= ?' : ''} ${confirmationStatus ? ' AND confirmation_status = ?' : ''}
          ORDER BY block_height ASC ${page ? ' LIMIT ? OFFSET ?' : ''};
      `, bindings
    );
    const total = result?.rows?.length > 0 ? result?.rows[0].total : 0;

    ctx.body = {
      paging: {
        total,
        limit: INTERACTIONS_PER_PAGE,
        items: result?.rows.length,
        page: parsedPage,
        pages: Math.ceil(total / INTERACTIONS_PER_PAGE)
      },
      interactions: result?.rows?.map((r: any) => ({
        status: r.confirmation_status,
        confirming_peers: r.confirming_peer,
        confirmations: r.confirmations,
        interaction: r.interaction
      }))
    };
    logger.debug("Interactions loaded in", benchmark.elapsed());

  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
