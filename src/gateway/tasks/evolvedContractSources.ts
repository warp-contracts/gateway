import { ContractType, getTag, SmartWeaveTags, WasmSrc } from "redstone-smartweave";
import {GatewayContext} from "../init";
import { TaskRunner } from "./TaskRunner";

const CONTRACTS_SOURCE_INTERVAL_MS = 10000;

export async function runEvolvedContractsSourceTask(context: GatewayContext) {
  await TaskRunner
    .from("[evolved contracts source]", loadEvolvedContractsSource, context)
    .runSyncEvery(CONTRACTS_SOURCE_INTERVAL_MS);
}

async function loadEvolvedContractsSource (context: GatewayContext) {
    const {logger, gatewayDb, arweaveWrapper} = context;
  
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
            const contractSrcTx = await arweaveWrapper.tx(srcTxId);

            const srcContentType = getTag(contractSrcTx, SmartWeaveTags.CONTENT_TYPE);

            const supportedSrcContentTypes = ['application/javascript', 'application/wasm'];

            if (supportedSrcContentTypes.indexOf(srcContentType) == -1) {
              throw new Error(`Contract source content type ${srcContentType} not supported`);
            }
        
            const src =
            srcContentType == 'application/javascript'
                ? await arweaveWrapper.txDataString(srcTxId)
                : await arweaveWrapper.txData(srcTxId);
        
            let srcWasmLang;
            let wasmSrc: WasmSrc;

            if (srcContentType == 'application/wasm') {
              wasmSrc = new WasmSrc(src as Buffer);
              srcWasmLang = getTag(contractSrcTx, SmartWeaveTags.WASM_LANG);

              if (!srcWasmLang) {
                throw new Error(`Wasm lang not set for wasm contract src ${srcTxId}`);
              }
            }
        
            let contracts_src_insert: any = {
              src_tx_id: srcTxId,
              src_content_type: srcContentType,
              src_tx: contractSrcTx.toJSON()
            }
      
            if (srcContentType == 'application/javascript') {
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
              .merge([
                'src',
                'src_content_type',
                'src_binary',
                'src_wasm_lang',
                'bundler_src_tx_id',
                'bundler_src_node',
                'src_tx']);
      
            logger.debug(`${row.evolve} evolved contract source inserted into db`);

          } catch (e) {
            logger.error(`Error while loading evolved contract source ${srcTxId}`, e);
          }
    }
  }
