import Router from '@koa/router';
import { evalType } from '../../tasks/contractsMetadata';
import { BUNDLR_NODE2_URL } from '../../../constants';
import { sleep } from 'warp-contracts';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';
import { sendNotificationToCache } from '../../publisher';
import { evalManifest, WarpDeployment } from './deployContractRoute';
import { Tag } from 'arweave/node/lib/transaction';
import { stringToB64Url } from 'arweave/node/lib/utils';
import { fetch } from 'undici';
import { backOff } from 'exponential-backoff';
import { getTestnetTag } from './deployBundledRoute';

const BUNDLR_QUERY = `query Transactions($ids: [String!]) {
    transactions(ids: $ids) {
      edges {
        node {
          address
        }
      }
    }
  }`;

const BUNDLR_NODES = ['node1', 'node2'] as const;
type BundlrNodeType = typeof BUNDLR_NODES[number];

export async function registerContractRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb } = ctx;

  let initStateRaw = '';
  let contractTx = null;
  let txId = '';

  try {
    const bundlrNode = ctx.request.body.bundlrNode;
    if (!bundlrNode || !isBundlrNodeType(bundlrNode)) {
      throw new Error(
        `Invalid Bundlr Node. Should be equal to one of the following values: ${BUNDLR_NODES.map((n) => n).join(
          ', '
        )}, found: ${bundlrNode}.`
      );
    }

    txId = ctx.request.body.id;

    const txMetadata = ((await getBundlrGqlMetadata(txId, bundlrNode)) as any).transactions.edges[0].node;

    const { contractTagsIncluded, tags, signature } = await verifyContractTags(txId);
    if (!contractTagsIncluded) {
      ctx.throw(400, 'Bundlr transaction is not valid contract transaction.');
    }

    logger.debug('Bundlr transaction marked as valid contract transaction.');

    let encodedTags: Tag[] = [];

    for (const tag of tags) {
      try {
        encodedTags.push(new Tag(stringToB64Url(tag.name), stringToB64Url(tag.value)));
      } catch (e: any) {
        throw new Error(`Unable to encode tag ${tag.name}: ${e.status}`);
      }
    }

    const srcTxId = tags.find((t: Tag) => t.name == 'Contract-Src')!.value;
    initStateRaw = tags.find((t: Tag) => t.name == 'Init-State')!.value;
    const initState = JSON.parse(initStateRaw);
    const type = evalType(initState);
    const ownerAddress = txMetadata.address;
    const contentType = tags.find((t: Tag) => t.name == 'Content-Type')!.value;
    const testnet = getTestnetTag(tags);
    const manifest = evalManifest(tags);

    contractTx = {
      id: txId,
      owner: ownerAddress,
      data: null,
      signature,
      target: '',
      tags: encodedTags,
    };

    const insert = {
      contract_id: txId,
      src_tx_id: srcTxId,
      init_state: initState,
      owner: ownerAddress,
      type: type,
      pst_ticker: type == 'pst' ? initState?.ticker : null,
      pst_name: type == 'pst' ? initState?.name : null,
      block_height: getCachedNetworkData().cachedNetworkInfo.height,
      block_timestamp: getCachedNetworkData().cachedBlockInfo.timestamp,
      content_type: contentType,
      contract_tx: contractTx,
      bundler_contract_tx_id: txId,
      bundler_contract_node: `https://${bundlrNode}.bundlr.network`,
      bundler_contract_tags: JSON.stringify(tags),
      bundler_response: '',
      testnet,
      deployment_type: WarpDeployment.External,
      manifest,
    };

    await gatewayDb('contracts').insert(insert);

    sleep(2000)
      .then(() => {
        sendNotificationToCache(ctx, txId, initState);
      })
      .catch((e) => {
        logger.error(`No sleep 'till Brooklyn.`, e);
      });

    logger.info('Contract successfully registered.', {
      contractTxId: txId,
    });

    ctx.body = {
      contractTxId: txId,
    };
  } catch (e: any) {
    logger.error('Error while registering bundled transaction.', {
      txId,
      contractTx,
      initStateRaw,
    });
    logger.error(e);
    ctx.body = e;
    ctx.status = e.status ? e.status : 500;
  }
}

export async function verifyContractTags(id: string) {
  let response: any;
  const request = async () => {
    return fetch(`${BUNDLR_NODE2_URL}/tx/${id}`).then((res) => {
      return res.ok ? res.json() : Promise.reject(res);
    });
  };
  try {
    response = await backOff(request, {
      delayFirstAttempt: false,
      maxDelay: 2000,
      numOfAttempts: 5,
    });
  } catch (error: any) {
    throw new Error(`Unable to retrieve Bundlr network tags response. ${error.status}.`);
  }
  const tags = response.tags;
  const signature = response.signature;
  const tagsIncluded = [
    { name: 'App-Name', value: 'SmartWeaveContract' },
    { name: 'App-Version', value: '0.3.0' },
  ];

  const nameTagsIncluded = ['Contract-Src', 'Init-State', 'Title', 'Description', 'Type', 'Content-Type'];

  const contractTagsIncluded =
    tagsIncluded.every((ti) => tags.some((t: Tag) => t.name == ti.name && t.value == ti.value)) &&
    nameTagsIncluded.every((nti) => tags.some((t: Tag) => t.name == nti));

  return { contractTagsIncluded, tags, signature };
}

export async function getBundlrGqlMetadata(id: string, bundlrNode: string) {
  const data = JSON.stringify({
    query: BUNDLR_QUERY,
    variables: { ids: [id] },
  });

  const response = await fetch(`https://${bundlrNode}.bundlr.network/graphql`, {
    method: 'POST',
    body: data,
    headers: {
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })
    .then((res) => {
      return res.ok ? res.json() : Promise.reject(res);
    })
    .catch((error) => {
      throw new Error(`Unable to retrieve Bundlr gql response. ${error.status}.`);
    });
  return (response as any).data;
}

export function isBundlrNodeType(value: string): value is BundlrNodeType {
  return BUNDLR_NODES.includes(value as BundlrNodeType);
}