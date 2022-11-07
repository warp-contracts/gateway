import { GatewayContext } from '../init';
import Router from "@koa/router";

export let cacheableContracts: Set<string> = new Set();

export async function loadCacheableContracts(context: GatewayContext) {
  const { logger, gatewayDb } = context;

  const result: any = await gatewayDb.raw(
    `
          SELECT contract_id
          FROM contracts 
          WHERE cacheable = true;
      `
  );

  if (result) {
    logger.debug(`Loaded ${result.rows.length} cacheable contracts.`);
    cacheableContracts = new Set(result.rows.map((r: any) => r.contract_id));
  }
}

export async function isCacheable(contractTxId: string, context: Router.RouterContext): Promise<boolean> {
  const { logger, gatewayDb } = context;

  try {
    const result: any = await gatewayDb.raw(
      `
          SELECT cacheable
          FROM contracts
          WHERE contract_id = ?;
      `, [contractTxId]
    );

    if (!result || !result.rows) {
      return false;
    }

    logger.info(result.rows);

    return result.rows[0].cacheable;
  } catch (e) {
    return false;
  }
}
