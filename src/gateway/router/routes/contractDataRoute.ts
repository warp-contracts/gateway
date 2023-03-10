import Router from '@koa/router';
import Arweave from 'arweave';
import { ArweaveWrapper, Benchmark, WarpLogger } from 'warp-contracts';
import { callbackToPromise, isTxIdValid } from '../../../utils';
import { gunzip } from 'zlib';
import Transaction from 'arweave/node/lib/transaction';
import { BUNDLR_NODE2_URL } from '../../../constants';
import { WarpDeployment } from './deployContractRoute';

export async function contractDataRoute(ctx: Router.RouterContext) {
  const { logger, dbSource, arweave, arweaveWrapper } = ctx;

  const { id } = ctx.params;

  if (!isTxIdValid(id as string)) {
    logger.error('Incorrect contract transaction id.');
    ctx.status = 500;
    ctx.body = { message: 'Incorrect contract transaction id.' };
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    logger.debug('ContractDataRoute id: ', id);

    const result: any = await dbSource.raw(
      `
          SELECT  bundler_contract_tx_id as "bundlerContractTxId",
                  bundler_contract_tags as "bundlerContractTags",
                  deployment_type as "deploymentType"
          FROM contracts 
          WHERE contract_id = ?;
      `,
      [id]
    );

    if (result?.rows[0] == null || result?.rows[0].bundlerContractTxId == null) {
      ctx.status = 500;
      ctx.body = { message: 'Contract not indexed as bundled.' };
    } else {
      const { data, contentType } = await getContractData(
        arweave,
        logger,
        result?.rows[0].bundlerContractTxId,
        result?.rows[0].bundlerContractTags || null,
        arweaveWrapper,
        result?.rows[0].deploymentType
      );
      ctx.body = data;
      ctx.set('Content-Type', contentType);
      logger.debug('Contract data loaded in', benchmark.elapsed());
    }
  } catch (e: any) {
    logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}

async function getContractData(
  arweave: Arweave,
  logger: WarpLogger,
  id: string,
  tags: object[],
  arweaveWrapper: ArweaveWrapper,
  deploymentType: string
) {
  let data: ArrayBuffer | Buffer;

  try {
    data = await arweaveWrapper.txData(id);
  } catch (e) {
    logger.error(`Error from Arweave Gateway while loading data: `, e);

    data = await fetch(`${BUNDLR_NODE2_URL}/tx/${id}/data`).then((res) => {
      return res.arrayBuffer();
    });
  }

  // decompress and decode contract transction data
  let bufData: ArrayBuffer | Buffer;
  // only txs which were not zipped have bundler contract tags
  if (!tags) {
    const gunzipPromisified = callbackToPromise(gunzip);
    bufData = await gunzipPromisified(data);
  } else {
    bufData = data;
  }
  const strData = arweave.utils.bufferToString(bufData);

  logger.debug('strData', strData);

  if (deploymentType == WarpDeployment.External) {
    const contentType = getContentTypeFromTag(tags);
    logger.debug(`Content type for id: ${id}: `, contentType);
    return { data: strData, contentType };
  } else {
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

function getContentTypeFromTag(tags: any) {
  const tagContentType = tags.find((tag: any) => tag.name == 'Content-Type').value;
  return tagContentType;
}
