import Router from '@koa/router';
import { Benchmark } from 'redstone-smartweave';

export async function statsTxPerDayRoute(ctx: Router.RouterContext) {
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
          WITH transactions_per_day AS (
              SELECT date(to_timestamp((interaction->'block'->>'timestamp')::integer)) as date, interaction_id as interaction
              FROM interactions
          )
          SELECT date, count(*) as per_day FROM transactions_per_day
          GROUP BY date
          ORDER BY date ASC;
      `
    );
    ctx.body = result?.rows;
    logger.debug('Stats loaded in', benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}
