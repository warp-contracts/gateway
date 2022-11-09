import Router from "@koa/router";
import {GatewayContext} from "./init";

const channel = 'contracts';

export function updateCache(contractTxId: string, ctx: Router.RouterContext | GatewayContext, sortKey?: string) {
  const {logger} = ctx;

  try {
    const message = {contractTxId, sortKey, test: false, source: 'warp-gw'};
    ctx.publisher.publish(channel, JSON.stringify(message));
    logger.info(`Published ${channel}`, message);
  } catch (e) {
    logger.error('Error while publishing message', e);
  }

}
