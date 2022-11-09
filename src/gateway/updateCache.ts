import Router from "@koa/router";

const channel = 'contracts';

export function updateCache(contractTxId: string, ctx: Router.RouterContext) {
  const {logger} = ctx;

  try {
    const message = {contractTxId, test: false, source: 'warp-gw'};
    ctx.publisher.publish(channel, JSON.stringify(message));
    logger.info(`Published ${message} to ${channel}`);
  } catch (e) {
    logger.error('Error while publishing message', e);
  }

}
