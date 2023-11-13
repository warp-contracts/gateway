import Router from '@koa/router';
import { evalType } from '../../../tasks/contractsMetadata';
import { getCachedNetworkData } from '../../../tasks/networkInfoCache';
import { publishContract, sendNotification } from '../../../publisher';
import { evalManifest, WarpDeployment } from './deployContractRoute';
import { Tag } from 'arweave/node/lib/transaction';
import { stringToB64Url } from 'arweave/node/lib/utils';
import { fetch } from 'undici';
import { backOff } from 'exponential-backoff';
import { getTestnetTag } from './deployBundledRoute';
import { ContractInsert } from '../../../../db/insertInterfaces';
import { GatewayError } from '../../../errorHandlerMiddleware';

const ARWEAVE_QUERY = `query Transaction($ids: [ID!]) {
    transactions(ids: $ids) {
      edges {
        node {
          id
          owner { address }
          tags {
            name
            value
          }
          signature
        }
      }
    }
  }`;

const REGISTER_PROVIDER = ['node1', 'node2', 'arweave'] as const;
type RegisterProviderType = typeof REGISTER_PROVIDER[number];

export async function registerContractRoute(ctx: Router.RouterContext) {
  const { logger, dbSource } = ctx;

  let initStateRaw = '';
  let contractTx = null;
  let txId = '';

  const registerProvider = ctx.request.body.registerProvider || ctx.request.body.bundlrNode;

  if (!registerProvider || !isRegisterProvider(registerProvider)) {
    throw new GatewayError(
      `Invalid register type. Should be equal to one of the following values: ${REGISTER_PROVIDER.map((n) => n).join(
        ', '
      )}, found: ${registerProvider}.`,
      400
    );
  }

  txId = ctx.request.body.id;

  const txMetadata: { tags: Tag[]; address: string; signature: string } =
    registerProvider == 'arweave'
      ? await getArweaveGqlMetadata(txId)
      : await getBundlrNetworkMetadata(txId, registerProvider);

  const tags = txMetadata.tags;
  const contractTagsIncluded = await verifyContractTags(tags);
  if (!contractTagsIncluded) {
    throw new GatewayError('Bundlr transaction is not valid contract transaction.', 400);
  }

  logger.debug('Contract transaction marked as valid contract transaction.');

  let encodedTags: Tag[] = [];

  for (const tag of tags) {
    try {
      encodedTags.push(new Tag(stringToB64Url(tag.name), stringToB64Url(tag.value)));
    } catch (e: any) {
      throw new GatewayError(`Unable to encode tag ${tag.name}: ${e.status}`, 400);
    }
  }

  try {
    const srcTxId = tags.find((t: Tag) => t.name == 'Contract-Src')!.value;
    initStateRaw = tags.find((t: Tag) => t.name == 'Init-State')!.value;
    const initState = JSON.parse(initStateRaw);
    const type = evalType(initState);
    const ownerAddress = txMetadata.address;
    const contentType = tags.find((t: Tag) => t.name == 'Content-Type')!.value;
    const testnet = getTestnetTag(tags);
    const manifest = evalManifest(tags);
    const blockHeight = getCachedNetworkData().cachedNetworkInfo.height;
    const blockTimestamp = getCachedNetworkData().cachedBlockInfo.timestamp;
    const syncTimestamp = Date.now();

    contractTx = {
      id: txId,
      owner: ownerAddress,
      data: null,
      signature: txMetadata.signature,
      target: '',
      tags: encodedTags,
    };

    const insert: ContractInsert = {
      contract_id: txId,
      src_tx_id: srcTxId,
      init_state: initState,
      owner: ownerAddress,
      type: type,
      pst_ticker: type == 'pst' ? initState?.ticker : null,
      pst_name: type == 'pst' ? initState?.name : null,
      block_height: blockHeight,
      block_timestamp: blockTimestamp,
      content_type: contentType,
      contract_tx: { tags: contractTx.tags },
      bundler_contract_tx_id: txId,
      bundler_contract_node: ['node1', 'node2'].includes(registerProvider)
        ? `https://${registerProvider}.bundlr.network`
        : `https://arweave.net`,
      testnet,
      deployment_type: WarpDeployment.External,
      manifest,
      sync_timestamp: syncTimestamp,
    };

    await dbSource.insertContract(insert);

    sendNotification(ctx, txId, { initState, tags, srcTxId });
    publishContract(
      ctx,
      txId,
      ownerAddress,
      type,
      blockHeight,
      blockTimestamp,
      WarpDeployment.External,
      syncTimestamp,
      testnet
    );

    logger.info('Contract successfully registered.', {
      contractTxId: txId,
    });

    ctx.body = {
      contractTxId: txId,
    };
  } catch (e: any) {
    throw new GatewayError(`Error while registering bundled transaction: ${e}.`, 500, {
      txId,
      contractTx,
      initStateRaw,
    });
  }
}

export async function verifyContractTags(tags: Tag[]) {
  const tagsIncluded = [
    { name: 'App-Name', value: 'SmartWeaveContract' },
    { name: 'App-Version', value: '0.3.0' },
  ];

  const nameTagsIncluded = ['Contract-Src', 'Init-State', 'Content-Type'];

  const contractTagsIncluded =
    tagsIncluded.every((ti) => tags.some((t: Tag) => t.name == ti.name && t.value == ti.value)) &&
    nameTagsIncluded.every((nti) => tags.some((t: Tag) => t.name == nti));

  return contractTagsIncluded;
}

export async function getBundlrNetworkMetadata(
  id: string,
  bundlrNode: string
): Promise<{ tags: Tag[]; address: string; signature: string }> {
  let response: any;
  const request = async () => {
    return fetch(`https://${bundlrNode}.bundlr.network/tx/${id}`).then((res) => {
      return res.ok ? res.json() : Promise.reject(res);
    });
  };
  try {
    response = (await backOff(request, {
      delayFirstAttempt: false,
      maxDelay: 2000,
      numOfAttempts: 5,
    })) as any;
  } catch (error: any) {
    throw new Error(`Unable to retrieve Bundlr network tags response. ${error.status}.`);
  }

  return { tags: response.tags, address: response.address, signature: response.signature };
}

export async function getArweaveGqlMetadata(id: string): Promise<{ tags: Tag[]; address: string; signature: string }> {
  const data = JSON.stringify({
    query: ARWEAVE_QUERY,
    variables: { ids: [id] },
  });

  let response: any;

  const request = async () => {
    return fetch(`https://arweave.net/graphql`, {
      method: 'POST',
      body: data,
      headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }).then((res) => {
      return res.ok ? res.json() : Promise.reject(res);
    });
  };
  try {
    response = (
      (await backOff(request, {
        delayFirstAttempt: false,
        maxDelay: 2000,
        numOfAttempts: 5,
      })) as any
    ).data.transactions.edges[0].node;
  } catch (error: any) {
    throw new Error(`Unable to retrieve Arweave gql response. ${error.status}.`);
  }

  return { tags: response.tags, address: response.owner.address, signature: response.signature };
}

export function isRegisterProvider(value: string): value is RegisterProviderType {
  return REGISTER_PROVIDER.includes(value as RegisterProviderType);
}
