import Router from '@koa/router';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';
import {GatewayError} from "../../errorHandlerMiddleware";

export async function arweaveInfoRoute(ctx: Router.RouterContext) {
  const { logger, dbSource } = ctx;

  const result = (await getCachedNetworkData(dbSource)).cachedNetworkInfo;
  if (result == null) {
    throw new GatewayError('Network info not yet available.')
  } else {
    logger.debug('Returning network info with height', result.height);
    ctx.body = {
      ...result,
    };
  }
}

export async function arweaveBlockRoute(ctx: Router.RouterContext) {
  const { logger, dbSource } = ctx;

  const result = (await getCachedNetworkData(dbSource)).cachedBlockInfo;
  if (result == null) {
    throw new GatewayError('Block info not yet available.');
  } else {
    logger.debug('Returning block info with block height', result.height);
    ctx.body = {
      ...result,
    };
  }
}
