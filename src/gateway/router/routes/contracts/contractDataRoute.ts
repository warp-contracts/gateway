import Router from '@koa/router';
import Arweave from 'arweave';
import { ArweaveWrapper, Benchmark, Tags, WarpLogger } from 'warp-contracts';
import { decodeTags, getTagByName, isTxIdValid } from '../../../../utils';
import Transaction from 'arweave/node/lib/transaction';
import { WarpDeployment } from '../deploy/deployContractRoute';
import { GatewayError } from '../../../errorHandlerMiddleware';

export async function contractDataRoute(ctx: Router.RouterContext) {
  const { logger, dbSource, arweave, arweaveWrapper } = ctx;

  const { id } = ctx.params;

  if (!isTxIdValid(id as string)) {
    throw new GatewayError('Incorrect contract transaction id.', 403);
  }

  const benchmark = Benchmark.measure();
  logger.debug('ContractDataRoute id: ', id);

  const result: any = await dbSource.raw(
    `
        SELECT bundler_contract_tx_id as "bundlerContractTxId",
               contract_tx -> 'tags'  as "contractTags",
               deployment_type        as "deploymentType",
               bundler_contract_node as "bundlrContractNode",
               contract_id as "contractId"
        FROM contracts
        WHERE contract_id = ?;
    `,
    [id]
  );
  if (result?.rows[0] == null || result?.rows[0].bundlerContractTxId == null) {
    throw new GatewayError('Contract not indexed as bundled.');
  } else {
    let tags: Tags = [];
    if (result?.rows[0].contractTags) {
      tags = decodeTags(result?.rows[0].contractTags);
    }

    const { data, contentType } = await getContractData(
      arweave,
      logger,
      result?.rows[0].contractId,
      result?.rows[0].bundlerContractTxId,
      tags,
      arweaveWrapper,
      result?.rows[0].deploymentType,
      result.rows[0].bundlrContractNode
    );
    ctx.body = data;
    ctx.set('Content-Type', contentType);
    logger.debug('Contract data loaded in', benchmark.elapsed());
  }
}

async function getContractData(
  arweave: Arweave,
  logger: WarpLogger,
  id: string,
  bundlrId: string,
  tags: Tags,
  arweaveWrapper: ArweaveWrapper,
  deploymentType: string,
  bundlrContractNode: string
) {
  let data: ArrayBuffer | Buffer;

  const effectiveId = deploymentType == WarpDeployment.Wrapped ? bundlrId : id;
  try {
    data = await arweaveWrapper.txData(effectiveId);
  } catch (e) {
    logger.error(`Error from Arweave Gateway while loading data: `, e);

    data = await fetch(`${bundlrContractNode}/tx/${effectiveId}/data`).then((res) => {
      return res.arrayBuffer();
    });
  }

  if (deploymentType == WarpDeployment.External || deploymentType == WarpDeployment.Direct) {
    const contentType = getTagByName(tags, 'Content-Type');
    logger.debug(`Content type for id: ${id}: `, contentType);
    return { data, contentType };
  } else {
    const strData = arweave.utils.bufferToString(data);
    const tx = new Transaction({ ...JSON.parse(strData) });
    const txData = Buffer.from(tx.data);
    const contentType = getContentTypeFromTx(tx);
    logger.debug(`Content type for id: ${id}: `, contentType);
    return { data: txData, contentType };
  }
}

function getContentTypeFromTx(tx: Transaction) {
  const tagContentType = tx
    .get('tags')
    // @ts-ignore
    .find((tag: BaseObject) => tag.get('name', { decode: true, string: true }) == 'Content-Type');

  return tagContentType.get('value', { decode: true, string: true });
}
