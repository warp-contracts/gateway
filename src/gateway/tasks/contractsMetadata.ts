import {TaskRunner} from "./TaskRunner";
import {GatewayContext} from "../init";
import {ContractDefinitionLoader} from "redstone-smartweave";

const CONTRACTS_METADATA_INTERVAL_MS = 30000;

export async function runContractsMetadataTask(context: GatewayContext) {
  await TaskRunner
    .from("[contracts metadata]", loadContractsMetadata, context)
    .runAsyncEvery(CONTRACTS_METADATA_INTERVAL_MS);
}

async function loadContractsMetadata(context: GatewayContext) {
  const {arweave, logger, gatewayDb} = context;
  const definitionLoader = new ContractDefinitionLoader(arweave);

  const result: { contract: string }[] = (await gatewayDb.raw(
    `
        SELECT contract_id AS contract
        FROM interactions
        WHERE contract_id != ''
          AND contract_id NOT ILIKE '()%'
          AND trim(contract_id) NOT IN (SELECT contract_id FROM contracts)
        GROUP BY contract_id;
    `
  )).rows;

  const missing = result?.length || 0;
  logger.info(`Loading ${missing} contract definitions.`);

  if (missing == 0) {
    return;
  }


  for (const row of result) {
    logger.debug(`Loading ${row.contract} definition.`);
    try {
      const definition = await definitionLoader.load(row.contract.trim());
      await gatewayDb("contracts")
        .insert({
          contract_id: definition.txId,
          src_tx_id: definition.srcTxId,
          src: definition.src,
          init_state: definition.initState,
          owner: definition.owner,
          type: evalType(definition.initState)
        })
        .onConflict("contract_id")
        .merge();
    } catch (e) {
      logger.error("Error while loading contract definition", e);
      await gatewayDb("contracts")
        .insert({
          contract_id: row.contract.trim(),
          src_tx_id: null,
          src: null,
          init_state: null,
          owner: null,
          type: "error"
        });
    }
  }

}

function evalType(initState: any): string {
  if (initState.ticker && initState.balances) {
    return "pst";
  }

  return "other";
}

