import Router from '@koa/router';
import { evalType } from '../../tasks/contractsMetadata';
import { BUNDLR_NODE2_URL } from '../../../constants';
import { DataItem } from 'arbundles';
import rawBody from 'raw-body';
import { sleep } from 'warp-contracts';
import { updateCache } from '../../updateCache';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';

export async function registerRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb, arweave, bundlr } = ctx;

  const rawDataItem: Buffer = await rawBody(ctx.req);
  const dataItem = new DataItem(rawDataItem);

  try {
    const isValid = await dataItem.isValid();
    if (!isValid) {
      ctx.throw(400, 'Data item binary is not valid.');
    }

    const areContractTagsValid = await verifyContractTags(dataItem, ctx);
    if (!areContractTagsValid) {
      ctx.throw(400, 'Contract tags are not valid.');
    }

    const bundlrResponse = await bundlr.uploader.transactionUploader(dataItem);

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

    logger.debug('Data item successfully bundled.', {
      id: bundlrResponse.data.id,
    });

    const srcTxId = dataItem.tags.find((t) => t.name == 'Contract-Src')!.value;
    const initStateRaw = dataItem.tags.find((t) => t.name == 'Init-State')!.value;
    const initState = JSON.parse(initStateRaw);
    const type = evalType(initState);
    const ownerAddress = await arweave.wallets.ownerToAddress(dataItem.owner);
    const contentType = dataItem.tags.find((t) => t.name == 'Content-Type')!.value;
    const testnet = getTestnetTag(dataItem.tags);

    const insert = {
      contract_id: bundlrResponse.data.id,
      src_tx_id: srcTxId,
      init_state: initState,
      owner: ownerAddress,
      type: type,
      pst_ticker: type == 'pst' ? initState?.ticker : null,
      pst_name: type == 'pst' ? initState?.name : null,
      block_height: getCachedNetworkData().cachedNetworkInfo.height,
      block_timestamp: getCachedNetworkData().cachedBlockInfo.timestamp,
      content_type: contentType,
      contract_tx: dataItem.toJSON(),
      bundler_contract_tx_id: bundlrResponse.data.id,
      bundler_contract_node: BUNDLR_NODE2_URL,
      bundler_contract_tags: JSON.stringify(dataItem.tags),
      bundler_response: JSON.stringify(bundlrResponse.data),
      testnet,
      deployment_type: 'warp-direct',
    };

    await gatewayDb('contracts').insert(insert);

    sleep(2000)
      .then(() => {
        updateCache(bundlrResponse.data.id, ctx);
      })
      .catch((e) => {
        logger.error(`No sleep 'till Brooklyn.`, e);
      });

    logger.info('Contract successfully registered.', {
      registeredContractId: bundlrResponse.data.id,
    });

    ctx.body = {
      registeredContractId: bundlrResponse.data.id,
    };
  } catch (e: any) {
    logger.error('Error while inserting bundled transaction.');
    logger.error(e);
    ctx.status = e.status;
    ctx.body = { message: e };
  }
}

export async function verifyContractTags(dataItem: DataItem, ctx: Router.RouterContext) {
  const tags = dataItem.tags;
  const tagsIncluded = [
    { name: 'App-Name', value: 'SmartWeaveContract' },
    { name: 'App-Version', value: '0.3.0' },
    { name: 'Content-Type', value: 'application/x.arweave-manifest+json' },
  ];
  const nameTagsIncluded = ['Contract-Src', 'Init-State', 'Title', 'Description', 'Type'];
  if (tags.some((t) => t.name == tagsIncluded[2].name && t.value != tagsIncluded[2].value)) {
    ctx.throw(400, `Incorrect Content-Type tag. application/x.arweave-manifest+json is required.`);
  }
  const contractTagsIncluded =
    tagsIncluded.every((ti) => tags.some((t) => t.name == ti.name && t.value == ti.value)) &&
    nameTagsIncluded.every((nti) => tags.some((t) => t.name == nti));

  console.log(contractTagsIncluded);
  return contractTagsIncluded;
}

export function getTestnetTag(tags: { name: string; value: string }[]) {
  const testnetTag = tags.find((t) => t.name == 'Warp-Testnet');
  if (testnetTag) {
    return testnetTag.value;
  } else {
    return null;
  }
}
