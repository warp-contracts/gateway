import Router from '@koa/router';
import { Benchmark } from 'redstone-smartweave';

export async function searchRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb } = ctx;

  const { phrase } = ctx.params;

  if (phrase?.length < 3) {
    ctx.body = [];
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT 1 as sort_order, contract_id, 'pst' as type, '{}'::jsonb as interaction, '' as confirmation_status, pst_ticker, pst_name
          FROM contracts
          WHERE pst_ticker ILIKE ? OR pst_name ILIKE ?
          UNION ALL
          SELECT 2 as sort_order, contract_id, 'contract' as type, '{}'::jsonb as interaction, '' as confirmation_status, '' as pst_ticker, '' as pst_name
          FROM contracts
          WHERE contract_id ILIKE ?
          GROUP BY contract_id, type
          UNION ALL
          SELECT 3 as sort_order, interaction_id, 'interaction' as type, interaction, confirmation_status, '' as pst_ticker, '' as pst_name
          FROM interactions
          WHERE interaction_id ILIKE ?
          ORDER BY sort_order
          LIMIT 30;
      `,
      [`${phrase}%`, `${phrase}%`, `${phrase}%`, `${phrase}%`]
    );
    ctx.body = result?.rows;
    logger.debug('Contracts loaded in', benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}
