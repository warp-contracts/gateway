import Router from '@koa/router';
import Arweave from 'arweave';
import { Benchmark, RedStoneLogger } from 'redstone-smartweave';
import { isTxIdValid } from '../../../utils';
import util from 'util';
import { gunzip } from 'zlib';
import Transaction from 'arweave/node/lib/transaction';

export async function contractDataRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb, arweave } = ctx;

  const { id } = ctx.params;

  if (!isTxIdValid(id as string)) {
    logger.error('Incorrect contract transaction id.');
    ctx.status = 500;
    ctx.body = { message: 'Incorrect contract transaction id.' };
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    logger.debug('Id', id);

    const result: any = await gatewayDb.raw(
      `
          SELECT bundler_contract_tx_id as "bundlerContractTxId"
          FROM contracts 
          WHERE contract_id = ?;
      `,
      [id]
    );

    if (result?.rows[0] == null || result?.rows[0].bundlerContractTxId == null) {
      ctx.status = 500;
      ctx.body = { message: 'Contract not indexed as bundled.' };
    } else {
      const { data, contentType } = await getContractData(arweave, logger, result?.rows[0].bundlerContractTxId);
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

async function getContractData(arweave: Arweave, logger: RedStoneLogger, id: string) {
  const data = await fetch(`https://arweave.net/${id}`)
    .then((res) => {
      return res.arrayBuffer();
    })
    .then((data) => {
      return data;
    });

  // decompress and decode contract transction data
  const gunzipPromisified = util.promisify(gunzip);
  const gunzippedData = await gunzipPromisified(data);
  logger.debug(`Gunzipped data for bundled contract: ${id}`, gunzippedData);
  const strData = arweave.utils.bufferToString(gunzippedData);
  logger.debug(`Parsed data for bundled contract: ${id}`, strData);
  const tx = new Transaction({ ...JSON.parse(strData) });
  const bufferFromTxData = Buffer.from(tx.data);

  // get contract transaction content type from its tag
  const contentType = await getContentType(tx);
  logger.debug(`Content type for id: ${id}: `, contentType);

  return { data: bufferFromTxData, contentType };
}

async function getContentType(tx: Transaction) {
  const tagContentType = await tx
    .get('tags')
    // @ts-ignore
    .find((tag: BaseObject) => tag.get('name', { decode: true, string: true }) == 'Content-Type');

  return await tagContentType.get('value', { decode: true, string: true });
}
