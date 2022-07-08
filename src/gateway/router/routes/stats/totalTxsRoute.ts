import Router from '@koa/router';
import { Benchmark } from 'warp-contracts';

export async function totalTxsRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb } = ctx;

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT 1 AS sort_order, count(i.id) AS total
          FROM interactions i
          UNION
          SELECT 2 AS sort_order, count(c.contract_id) AS total
          FROM contracts c WHERE c.type != 'error'
          ORDER BY sort_order;
      `
    );
    ctx.body = {
      total_interactions: result?.rows[0].total,
      total_contracts: result?.rows[1].total,
    };

    logger.debug('Stats loaded in', benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}
