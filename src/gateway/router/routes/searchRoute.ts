import Router from '@koa/router';
import { Benchmark } from 'warp-contracts';

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
          SELECT 1 as sort_order, contract_id as id, 'pst' as type, '{}'::jsonb as interaction, '' as confirmation_status, pst_ticker, pst_name
          FROM contracts
          WHERE pst_ticker ILIKE ? OR pst_name ILIKE ?
          UNION ALL
          SELECT 2 as sort_order, contract_id as id, 'contract' as type, '{}'::jsonb as interaction, '' as confirmation_status, '' as pst_ticker, '' as pst_name
          FROM contracts
          WHERE contract_id ILIKE ?
          GROUP BY contract_id, type
          UNION ALL
          SELECT 3 as sort_order, interaction_id as id, 'interaction' as type, interaction, confirmation_status, '' as pst_ticker, '' as pst_name
          FROM interactions
          WHERE interaction_id ILIKE ?
          UNION ALL
          SELECT 4 as sort_order, src_tx_id as id, 'source' as type, '{}'::jsonb as interaction, '' as confirmation_status, '' as pst_ticker, '' as pst_name
          FROM contracts_src
          WHERE src_tx_id ILIKE ?
          UNION ALL
          SELECT 5 as sort_order, creator_id as id, 'creator' as type, '{}'::jsonb as interaction, '' as confirmation_status, '' as pst_ticker, '' as pst_name
          FROM
          (
            WITH temp_creator AS (
                SELECT DISTINCT owner as creator_id from interactions where owner ILIKE ?
                UNION ALL
                SELECT DISTINCT owner as creator_id FROM contracts WHERE owner ILIKE ?
            )
            SELECT DISTINCT * FROM temp_creator) AS creator
          ORDER BY sort_order
          LIMIT 30;
      `,
      [`${phrase}%`, `${phrase}%`, `${phrase}%`, `${phrase}%`, `${phrase}%`, `${phrase}%`, `${phrase}%`]
    );
    ctx.body = result?.rows;
    logger.debug('Contracts loaded in', benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}
