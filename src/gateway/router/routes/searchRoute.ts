import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

export async function searchRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  const {phrase} = ctx.params;

  if (phrase?.length < 3) {
    ctx.body = [];
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT DISTINCT(contract_id), 'contract' as type, '{}'::jsonb as interaction, '' as confirmation_status
          FROM interactions
          WHERE contract_id ILIKE ?
          GROUP BY contract_id, type
          UNION ALL
          SELECT interaction_id, 'interaction' as type, interaction, confirmation_status
          FROM interactions
          WHERE interaction_id ILIKE ?
          UNION ALL
          SELECT contract_id, 'pst_contract' as type, '{}'::jsonb as interaction, '' as confirmation_status
          FROM contracts
          WHERE pst_ticker ILIKE ? OR pst_name ILIKE ?
          ORDER BY type
          LIMIT 30;
      `, [`${phrase}%`, `${phrase}%`, `${phrase}%`, `${phrase}%`]
    );
    ctx.body = result?.rows;
    logger.debug("Contracts loaded in", benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
