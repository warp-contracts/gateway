import { GatewayContext } from '../init';

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
