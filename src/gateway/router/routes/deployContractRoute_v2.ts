import Router from '@koa/router';
import { evalType } from '../../tasks/contractsMetadata';
import { BUNDLR_NODE2_URL } from '../../../constants';
import { Bundle, DataItem } from 'arbundles';
import { sleep, SmartWeaveTags } from 'warp-contracts';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';
import { sendNotificationToCache } from '../../publisher';
import { evalManifest, WarpDeployment } from './deployContractRoute';
import Arweave from 'arweave';
import { SignatureConfig } from 'arbundles/src/constants';
import { utils } from 'ethers';
import { longTo32ByteArray } from 'arbundles/src/utils';

export async function deployContractRoute_v2(ctx: Router.RouterContext) {
  const { logger, gatewayDb, arweave } = ctx;

  let initStateRaw, contractDataItem, srcDataItem, srcBundlrResponse;

  try {
    contractDataItem = new DataItem(Buffer.from(ctx.request.body.contract));
    const isContractValid = await contractDataItem.isValid();
    if (!isContractValid) {
      ctx.throw(400, 'Contract data item binary is not valid.');
    }
    const areContractTagsValid = await verifyDeployTags(contractDataItem, { contract: true });
    if (!areContractTagsValid) {
      ctx.throw(400, 'Contract tags are not valid.');
    }

    if (ctx.request.body.src) {
      srcDataItem = new DataItem(Buffer.from(ctx.request.body.src));
      const isSrcValid = await srcDataItem.isValid();
      if (!isSrcValid) {
        ctx.throw(400, 'Source data item binary is not valid.');
      }

      const areSrcTagsValid = await verifyDeployTags(srcDataItem);
      if (!areSrcTagsValid) {
        ctx.throw(400, 'Contract source tags are not valid.');
      }
    }

    if (srcDataItem) {
      let srcId, srcContentType, src, srcBinary, srcWasmLang, bundlrSrcTxId, srcOwner, srcTestnet;
      srcId = srcDataItem.id;
      logger.debug('New deploy source transaction', srcId);
      srcOwner = await determineOwner(srcDataItem, arweave);
      srcTestnet = getTestnetTag(srcDataItem.tags);
      srcContentType = srcDataItem.tags.find((t) => t.name == 'Content-Type')!.value;
      srcWasmLang = srcDataItem.tags.find((t) => t.name == SmartWeaveTags.WASM_LANG)?.value;
      if (srcContentType == 'application/javascript') {
        src = Arweave.utils.bufferToString(srcDataItem.rawData);
      } else {
        srcBinary = Buffer.from(srcDataItem.data);
      }

      const bundlrResponse = await bundleAndUpload(srcDataItem, ctx);

      bundlrSrcTxId = bundlrResponse.data.id;
      srcBundlrResponse = bundlrResponse;
      logger.debug('Contract source successfully uploaded to Bundlr.', {
        id: srcId,
        bundled_tx_id: bundlrSrcTxId,
      });

      let contracts_src_insert: any = {
        src_tx_id: srcId,
        owner: srcOwner,
        src: src || null,
        src_content_type: srcContentType,
        src_binary: srcBinary || null,
        src_wasm_lang: srcWasmLang || null,
        bundler_src_tx_id: bundlrSrcTxId,
        bundler_src_node: BUNDLR_NODE2_URL,
        bundler_response: JSON.stringify(srcBundlrResponse?.data),
        src_tx: srcDataItem.toJSON(),
        testnet: srcTestnet,
        deployment_type: WarpDeployment.Direct,
      };

      await gatewayDb('contracts_src').insert(contracts_src_insert).onConflict('src_tx_id').ignore();
    }
    const bundlrResponse = await bundleAndUpload(contractDataItem, ctx, { contract: true });
    logger.debug('Contract successfully uploaded to Bundlr.', {
      id: contractDataItem.id,
      bundled_tx_id: bundlrResponse.data.id,
    });

    const srcId = contractDataItem.tags.find((t) => t.name == 'Contract-Src')!.value;
    initStateRaw = contractDataItem.tags.find((t) => t.name == 'Init-State')?.value;
    if (!initStateRaw) {
      initStateRaw = Arweave.utils.bufferToString(contractDataItem.rawData);
    }
    const initState = JSON.parse(initStateRaw);
    const type = evalType(initState);
    const ownerAddress = await determineOwner(contractDataItem, arweave);
    const contentType = contractDataItem.tags.find((t) => t.name == 'Content-Type')!.value;
    const testnet = getTestnetTag(contractDataItem.tags);
    const manifest = evalManifest(contractDataItem.tags);

    const insert = {
      contract_id: contractDataItem.id,
      src_tx_id: srcId,
      init_state: initState,
      owner: ownerAddress,
      type: type,
      pst_ticker: type == 'pst' ? initState?.ticker : null,
      pst_name: type == 'pst' ? initState?.name : null,
      block_height: getCachedNetworkData().cachedNetworkInfo.height,
      block_timestamp: getCachedNetworkData().cachedBlockInfo.timestamp,
      content_type: contentType,
      contract_tx: contractDataItem.toJSON(),
      bundler_contract_tx_id: bundlrResponse.data.id,
      bundler_contract_node: BUNDLR_NODE2_URL,
      bundler_contract_tags: JSON.stringify(contractDataItem.tags),
      bundler_response: JSON.stringify(bundlrResponse.data),
      testnet,
      deployment_type: WarpDeployment.Direct,
      manifest,
    };

    await gatewayDb('contracts').insert(insert);

    sleep(2000)
      .then(() => {
        sendNotificationToCache(ctx, bundlrResponse.data.id, initState);
      })
      .catch((e) => {
        logger.error(`No sleep 'till Brooklyn.`, e);
      });

    logger.info('Contract successfully deployed.', {
      contractTxId: contractDataItem.id,
      bundlrContractTxId: bundlrResponse.data.id,
      srcTxId: srcDataItem?.id || srcId,
      bundlrSrcTxId: srcBundlrResponse?.data.id,
    });

    ctx.body = {
      contractTxId: contractDataItem.id,
    };
  } catch (e: any) {
    logger.error('Error while inserting bundled transaction.', {
      dataItemId: contractDataItem?.id,
      contract: contractDataItem?.toJSON(),
      initStateRaw: initStateRaw,
    });
    logger.error(e);
    ctx.body = e;
    ctx.status = e.status ? e.status : 500;
  }
}

export async function verifyDeployTags(dataItem: DataItem, opts?: { contract: boolean }) {
  const tags = dataItem.tags;

  const deployTags = [
    { name: SmartWeaveTags.APP_NAME, value: opts?.contract ? 'SmartWeaveContract' : 'SmartWeaveContractSource' },
    { name: SmartWeaveTags.APP_VERSION, value: '0.3.0' },
    { name: SmartWeaveTags.SDK, value: 'Warp' },
  ];

  const contractNameTags = ['Contract-Src', 'Nonce'];
  const sourceNameTags = ['Nonce', 'Content-Type'];
  const tagsIncluded =
    deployTags.every((dt) => tags.some((t) => t.name == dt.name && t.value == dt.value)) &&
    (opts?.contract ? contractNameTags : sourceNameTags).every((nti) => tags.some((t) => t.name == nti));

  return tagsIncluded;
}

export function getTestnetTag(tags: { name: string; value: string }[]) {
  const testnetTag = tags.find((t) => t.name == 'Warp-Testnet');
  if (testnetTag) {
    return testnetTag.value;
  } else {
    return null;
  }
}

export async function determineOwner(dataItem: DataItem, arweave: Arweave) {
  if (dataItem.signatureType == SignatureConfig.ARWEAVE) {
    return await arweave.wallets.ownerToAddress(dataItem.owner);
  } else if (dataItem.signatureType == SignatureConfig.ETHEREUM) {
    return utils.computeAddress(utils.hexlify(dataItem.rawOwner));
  }
}

export async function bundleAndUpload(dataItem: DataItem, ctx: Router.RouterContext, opts?: { contract: boolean }) {
  const { bundlr } = ctx;
  const bundle = await bundleData([dataItem]);

  const bundlrTx = bundlr.createTransaction(bundle.getRaw(), {
    tags: [
      { name: 'Bundle-Format', value: 'binary' },
      { name: 'Bundle-Version', value: '2.0' },
      { name: 'App-Name', value: 'Warp' },
      { name: 'Action', value: opts?.contract ? 'ContractDeployment' : 'ContractSrcDeployment' },
      { name: opts?.contract ? 'Contract-Id' : 'Contract-Src-Id', value: dataItem.id },
    ],
  });
  await bundlrTx.sign();
  const bundlrResponse = await bundlr.uploader.uploadTransaction(bundlrTx, { getReceiptSignature: true });
  if (
    bundlrResponse.status !== 200 ||
    !bundlrResponse.data.public ||
    !bundlrResponse.data.signature ||
    !bundlrResponse.data.block
  ) {
    throw new Error(
      `Bundlr did not upload transaction correctly. Bundlr responded with status ${bundlrResponse.status}.`
    );
  }

  return bundlrResponse;
}

export async function bundleData(dataItems: DataItem[]): Promise<Bundle> {
  const headers = new Uint8Array(64 * dataItems.length);

  const binaries = await Promise.all(
    dataItems.map(async (d, index) => {
      const id = d.rawId;
      // Create header array
      const header = new Uint8Array(64);
      // Set offset
      header.set(longTo32ByteArray(d.getRaw().byteLength), 0);
      // Set id
      header.set(id, 32);
      // Add header to array of headers
      headers.set(header, 64 * index);
      // Convert to array for flattening
      return d.getRaw();
    })
  ).then((a) => {
    return Buffer.concat(a);
  });

  const buffer = Buffer.concat([longTo32ByteArray(dataItems.length), headers, binaries]);

  return new Bundle(buffer);
}
