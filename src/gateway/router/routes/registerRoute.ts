import Router from '@koa/router';
import { evalType } from '../../tasks/contractsMetadata';
import { BUNDLR_NODE2_URL } from '../../../constants';
import { DataItem } from 'arbundles';
import rawBody from 'raw-body';
import { Tag } from 'arweave/node/lib/transaction';
import { sleep } from 'warp-contracts';
import { updateCache } from '../../updateCache';

export async function registerRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb, arweave, bundlr } = ctx;

  const rawDataItem: Buffer = await rawBody(ctx.req);
  const dataItem = new DataItem(rawDataItem);

  try {
    const isValid = await dataItem.isValid();
    if (!isValid) {
      throw new Error(`Data item binary is not valid.`);
    }

    const areContractTagsValid = await verifyContractTags(dataItem);
    if (!areContractTagsValid) {
      throw new Error(`Contract tags are not valid.`);
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

    const srcTxId = dataItem.tags.find((d) => d.name == 'Contract-Src')!.value;
    const initStateRaw = dataItem.tags.find((d) => d.name == 'Init-State')!.value;
    const initState = JSON.parse(initStateRaw);
    const type = evalType(initState);
    const ownerAddress = await arweave.wallets.ownerToAddress(bundlrResponse.data.public);
    const contentType = dataItem.tags.find((d) => d.name == 'Content-Type')!.value;

    const insert = {
      contract_id: bundlrResponse.data.id,
      src_tx_id: srcTxId,
      init_state: initState,
      owner: ownerAddress,
      type: type,
      pst_ticker: type == 'pst' ? initState?.ticker : null,
      pst_name: type == 'pst' ? initState?.name : null,
      block_height: null,
      block_timestamp: null,
      content_type: contentType,
      contract_tx: null,
      bundler_contract_tx_id: bundlrResponse.data.id,
      bundler_contract_node: BUNDLR_NODE2_URL,
      bundler_contract_tags: JSON.stringify(dataItem.tags),
      testnet: null,
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
  } catch (e) {
    logger.error('Error while inserting data item.');
    logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}

export async function verifyContractTags(dataItem: DataItem) {
  const tags = dataItem.tags;
  const tagsIncluded = [
    new Tag('App-Name', 'SmartWeaveContract'),
    new Tag('App-Version', '0.3.0'),
    new Tag('Content-Type', 'application/x.arweave-manifest+json'),
  ];
  const nameTagsIncluded = ['Contract-Src', 'Init-State', 'Title', 'Description', 'Type'];

  const contractTagsIncluded =
    tagsIncluded.every((ti) => tags.some((t) => t.name == ti.name && t.value == ti.value)) &&
    nameTagsIncluded.every((nti) => tags.some((t) => t.name == nti));

  return contractTagsIncluded;
}
