import Router from '@koa/router';
import Transaction from 'arweave/node/lib/transaction';
import Arweave from 'arweave';
import { Benchmark, GQLTagInterface, SMART_WEAVE_TAGS, WARP_TAGS, WarpLogger } from "warp-contracts";
import { BUNDLR_NODE1_URL } from '../../../../constants';
import { prepareTags, tagValue, verifyEvmSignature, WarpDeployment } from './deployContractRoute';
import { ContractSourceInsert } from '../../../../db/insertInterfaces';
import { GatewayError } from '../../../errorHandlerMiddleware';
import Irys from "@irys/sdk";

export async function deploySourceRoute(ctx: Router.RouterContext) {
  const { logger, arweave, bundlr, dbSource } = ctx;

  const srcTx: Transaction = new Transaction({ ...ctx.request.body.srcTx });

  logger.debug('New deploy source transaction', srcTx.id);

  try {
    let srcTxId, srcContentType, src, srcBinary, srcWasmLang, bundlrSrcTxId, srcTxOwner, srcTestnet, srcBundlrResponse;

    srcTxId = srcTx.id;
    const srcTagsData = await prepareTags(srcTx, srcTx.owner, logger, arweave);

    await verifyEvmSignature(srcTagsData.isEvmSigner, ctx, srcTx);

    srcTxOwner = srcTagsData.originalAddress;
    srcTestnet = srcTagsData.testnet;
    srcContentType = tagValue(SMART_WEAVE_TAGS.CONTENT_TYPE, srcTagsData.tags);
    srcWasmLang = tagValue(WARP_TAGS.WASM_LANG, srcTagsData.tags);
    if (srcContentType == 'application/javascript') {
      src = Arweave.utils.bufferToString(srcTx.data);
    } else {
      srcBinary = Buffer.from(srcTx.data);
    }
    const { bTx: bundlrSrcTx, bundlrResponse } = await uploadToBundlr(srcTx, bundlr, srcTagsData.tags, logger);
    bundlrSrcTxId = bundlrSrcTx.id;
    srcBundlrResponse = bundlrResponse;
    logger.debug('Contract source successfully uploaded to Bundlr.', {
      id: srcTxId,
      bundled_tx_id: bundlrSrcTxId,
    });

    let contracts_src_insert: ContractSourceInsert = {
      src_tx_id: srcTxId,
      owner: srcTxOwner,
      src: src || null,
      src_content_type: srcContentType,
      src_binary: srcBinary || null,
      src_wasm_lang: srcWasmLang || null,
      bundler_src_tx_id: bundlrSrcTxId,
      bundler_src_node: BUNDLR_NODE1_URL,
      bundler_response: JSON.stringify(srcBundlrResponse?.data),
      src_tx: { ...srcTx.toJSON(), data: null },
      testnet: srcTestnet,
      deployment_type: WarpDeployment.Wrapped,
    };

    await dbSource.insertContractSource(contracts_src_insert);

    logger.info('Contract source successfully bundled and inserted.', {
      srcTxId,
      bundlrSrcTxId,
    });

    ctx.body = {
      srcTxId,
      bundlrSrcTxId,
    };
  } catch (e) {
    throw new GatewayError(`Error while inserting bundled source transaction ${e}`);
  }
}

export async function uploadToBundlr(
  transaction: Transaction,
  bundlr: Irys,
  tags: GQLTagInterface[],
  logger: WarpLogger
) {
  const uploadBenchmark = Benchmark.measure();

  const bTx = bundlr.createTransaction(JSON.stringify(transaction), { tags });
  await bTx.sign();
  const bundlrResponse = await bundlr.uploader.uploadTransaction(bTx);

  logger.debug('Uploading to bundlr', {
    elapsed: uploadBenchmark.elapsed(),
    id: bundlrResponse.data.id,
    status: bundlrResponse.status,
  });

  if (bundlrResponse.status !== 200 || !bundlrResponse.data.signature) {
    throw new Error(
      `Bundlr did not upload transaction ${bTx?.id} correctly. Bundlr responded with status ${bundlrResponse.status}.`
    );
  }

  return { bTx, bundlrResponse };
}
