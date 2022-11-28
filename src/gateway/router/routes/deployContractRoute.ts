import Router, { RouterContext } from '@koa/router';
import Transaction from 'arweave/node/lib/transaction';
import Arweave from 'arweave';
import { GQLTagInterface, SmartWeaveTags } from 'warp-contracts';
import { evalType } from '../../tasks/contractsMetadata';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';
import { BUNDLR_NODE2_URL } from '../../../constants';
import { uploadToBundlr } from './sequencerRoute';
import { sendNotificationToCache } from '../../publisher';
import { sleep } from '../../../utils';

export async function deployContractRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb, arweave, bundlr } = ctx;

  const contractTx: Transaction = new Transaction({ ...ctx.request.body.contractTx });
  let srcTx: Transaction | null = null;
  if (ctx.request.body.srcTx) {
    srcTx = new Transaction({ ...ctx.request.body.srcTx });
  }

  logger.debug('New deploy contract transaction', contractTx.id);

  const originalOwner = contractTx.owner;
  const {
    tags: contractTags,
    testnet: contractTestnet,
    originalAddress,
    isEvmSigner,
  } = await prepareTags(contractTx, originalOwner, logger, arweave);

  await verifyEvmSignature(isEvmSigner, ctx, contractTx);

  try {
    let srcTxId, srcContentType, src, srcBinary, srcWasmLang, bundlerSrcTxId, srcTxOwner, srcTestnet, srcBundlrResponse;

    if (srcTx) {
      srcTxId = srcTx.id;
      const srcTagsData = await prepareTags(srcTx, srcTx.owner, logger, arweave);

      await verifyEvmSignature(srcTagsData.isEvmSigner, ctx, srcTx);

      srcTxOwner = srcTagsData.originalAddress;
      srcTestnet = srcTagsData.testnet;
      srcContentType = tagValue(SmartWeaveTags.CONTENT_TYPE, srcTagsData.tags);
      srcWasmLang = tagValue(SmartWeaveTags.WASM_LANG, srcTagsData.tags);
      if (srcContentType == 'application/javascript') {
        src = Arweave.utils.bufferToString(srcTx.data);
      } else {
        srcBinary = Buffer.from(srcTx.data);
      }
      const { bTx: bundlrSrcTx, bundlrResponse } = await uploadToBundlr(srcTx, bundlr, srcTagsData.tags, logger);
      bundlerSrcTxId = bundlrSrcTx.id;
      srcBundlrResponse = bundlrResponse;
      logger.debug('Src Tx successfully bundled', {
        id: srcTxId,
        bundled_tx_id: bundlerSrcTxId,
      });
    } else {
      srcTxId = tagValue(SmartWeaveTags.CONTRACT_SRC_TX_ID, contractTags);
      if (!srcTxId) {
        throw new Error('SrcTxId not defined');
      }
      // maybe ad some sanity check here - whether the src is already indexed by the gateway?
    }

    const { bTx: bundlerContractTx, bundlrResponse: contractBundlrResponse } = await uploadToBundlr(
      contractTx,
      bundlr,
      contractTags,
      logger
    );
    logger.debug('Contract Tx successfully bundled', {
      id: contractTx.id,
      bundled_tx_id: bundlerContractTx.id,
    });

    let initStateRaw = tagValue(SmartWeaveTags.INIT_STATE, contractTags);
    if (!initStateRaw) {
      initStateRaw = Arweave.utils.bufferToString(contractTx.data);
    }
    const initState = JSON.parse(initStateRaw);
    const type = evalType(initState);

    const insert = {
      contract_id: contractTx.id,
      src_tx_id: srcTxId,
      init_state: initState,
      owner: originalAddress,
      type: type,
      pst_ticker: type == 'pst' ? initState?.ticker : null,
      pst_name: type == 'pst' ? initState?.name : null,
      block_height: getCachedNetworkData().cachedNetworkInfo.height,
      block_timestamp: getCachedNetworkData().cachedBlockInfo.timestamp,
      content_type: tagValue(SmartWeaveTags.CONTENT_TYPE, contractTags),
      contract_tx: { ...contractTx.toJSON(), data: null },
      bundler_contract_tx_id: bundlerContractTx.id,
      bundler_contract_node: BUNDLR_NODE2_URL,
      bundler_contract_tags: JSON.stringify(contractTags),
      bundler_response: JSON.stringify(contractBundlrResponse.data),
      testnet: contractTestnet,
      deployment_type: 'warp-wrapped',
    };

    await gatewayDb('contracts').insert(insert);

    if (srcTx) {
      let contracts_src_insert: any = {
        src_tx_id: srcTxId,
        owner: srcTxOwner,
        src: src || null,
        src_content_type: srcContentType,
        src_binary: srcBinary || null,
        src_wasm_lang: srcWasmLang || null,
        bundler_src_tx_id: bundlerSrcTxId,
        bundler_src_node: BUNDLR_NODE2_URL,
        bundler_response: JSON.stringify(srcBundlrResponse?.data),
        src_tx: { ...srcTx.toJSON(), data: null },
        testnet: srcTestnet,
        deployment_type: 'warp-wrapped',
      };

      await gatewayDb('contracts_src').insert(contracts_src_insert).onConflict('src_tx_id').ignore();
    }

    sleep(2000)
      .then(() => {
        sendNotificationToCache(ctx, contractTx.id, initState);
      })
      .catch((e) => {
        logger.error(`No sleep 'till Brooklyn.`, e);
      });

    logger.info('Contract successfully bundled.');

    ctx.body = {
      contractId: contractTx.id,
      bundleContractId: bundlerContractTx.id,
      srcTxId: srcTxId,
      bundleSrcId: bundlerSrcTxId,
    };
  } catch (e) {
    logger.error('Error while inserting bundled transaction');
    logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}

function tagValue(name: string, tags: GQLTagInterface[]): string | undefined {
  const tag = tags.find((t) => t.name == name);
  return tag?.value;
}

async function prepareTags(
  transaction: Transaction,
  originalOwner: string,
  logger: any,
  arweave: Arweave
): Promise<{ tags: GQLTagInterface[]; testnet: string | null; originalAddress: string; isEvmSigner: boolean }> {
  const decodedTags: GQLTagInterface[] = [];
  let testnet = null,
    isEvmSigner = false,
    originalAddress = '';

  transaction.tags.forEach((tag) => {
    const key = tag.get('name', { decode: true, string: true });
    const value = tag.get('value', { decode: true, string: true });
    decodedTags.push({
      name: key,
      value: value,
    });
    if (key == 'Warp-Testnet') {
      testnet = value;
    }
    if (key == 'Signature-Type' && value == 'ethereum') {
      logger.info(`Signature type for ${transaction.id}`, value);
      originalAddress = originalOwner;
      isEvmSigner = true;
    }
  });

  if (!isEvmSigner) {
    originalAddress = await arweave.wallets.ownerToAddress(originalOwner);
  }

  const tags = [
    { name: 'Uploader', value: 'RedStone' },
    { name: 'Uploader-Contract-Owner', value: originalAddress },
    { name: 'Uploader-Tx-Id', value: transaction.id },
    { name: 'Uploader-Bundler', value: BUNDLR_NODE2_URL },
    ...decodedTags,
  ];

  return { tags, testnet, originalAddress, isEvmSigner };
}

async function verifyEvmSignature(isEvmSigner: boolean, ctx: RouterContext, tx: Transaction): Promise<void> {
  if (isEvmSigner) {
    const isSignatureCorrect = await ctx.signatureVerification.process(tx);
    if (isSignatureCorrect) {
      ctx.logger.info(`Transaction's EVM signature is correct.`);
    } else {
      throw new Error(`Transaction's EVM signature is incorrect.`);
    }
  }
}
