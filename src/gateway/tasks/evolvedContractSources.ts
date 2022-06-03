import { ContractDefinitionLoader, ContractSource } from "redstone-smartweave";
import {GatewayContext} from "../init";
import { TaskRunner } from "./TaskRunner";

const CONTRACTS_SOURCE_INTERVAL_MS = 10000;

export async function runEvolvedContractsSourceTask(context: GatewayContext) {
  await TaskRunner
    .from("[evolved contracts source]", loadEvolvedContractsSource, context)
    .runSyncEvery(CONTRACTS_SOURCE_INTERVAL_MS);
}

async function loadEvolvedContractsSource (context: GatewayContext) {
  const {logger, gatewayDb, arweaveWrapper, arweave} = context;
  const definitionLoader = new ContractDefinitionLoader(arweave);
  
  const result: { evolve: string }[] = (await gatewayDb.raw(
      `
          SELECT evolve
          FROM interactions
          WHERE evolve NOT IN (SELECT src_tx_id from contracts_src)
          AND evolve IS NOT NULL;
      `
    )).rows;
    
  const missing = result?.length || 0;
  logger.info(`Loading ${missing} evolved contract sources.`);
    
  if (missing == 0) {
    return;
  }
  
  for (const row of result) {
    logger.debug(`Loading evolved contract source: ${row.evolve}.`);
    const srcTxId = row.evolve;

    try {  
      const {src, srcWasmLang, contractType, srcTx}: ContractSource = await definitionLoader.loadContractSource(srcTxId);
        
      let contracts_src_insert: any = {
        src_tx_id: srcTxId,
        src_content_type: contractType == 'js'
        ? 'application/javascript'
        : 'application/wasm',
        src_tx: srcTx
      }
      
      if (contractType == 'js') {
        contracts_src_insert = {
          ...contracts_src_insert,
          src: src
        }
      } else {
        const rawTxData = await arweaveWrapper.txData(srcTxId);
        contracts_src_insert = {
          ...contracts_src_insert,
          src_binary: rawTxData,
          src_wasm_lang: srcWasmLang
        }
      }

      logger.debug(`Inserting ${row.evolve} evolved contract source into db`);

      await gatewayDb("contracts_src")
        .insert(contracts_src_insert)
        .onConflict("src_tx_id")
        .ignore();
      
      logger.debug(`${row.evolve} evolved contract source inserted into db`);

    } catch (e) {
      logger.error(`Error while loading evolved contract source ${srcTxId}`, e);
    }
  }
}
