import Router from "@koa/router";
import {GatewayContext} from "./init";
import {publish as appSyncPublish} from "warp-contracts-pubsub";

const contractsChannel = 'contracts';


export function updateCache(contractTxId: string, ctx: Router.RouterContext | GatewayContext, sortKey?: string, lastSortKey?: string) {
  const {logger} = ctx;

  if (ctx.localEnv) {
    logger.info('Skipping publish contract notification for local env');
    return;
  }
  try {
    const message = {contractTxId, sortKey, test: false, source: 'warp-gw'};
    ctx.publisher.publish(contractsChannel, JSON.stringify(message));
    logger.info(`Published ${contractsChannel}`, message);
  } catch (e) {
    logger.error('Error while publishing message', e);
  }
}

export function publishInteraction(
  ctx: Router.RouterContext | GatewayContext,
  contractTxId: string,
  interaction: any,
  sortKey: string,
  lastSortKey: string | null) {

  const {logger, appSync} = ctx;

  if (!appSync) {
    logger.warn('App sync key not set');
    return;
  }

  appSyncPublish(`${ctx.localEnv ? 'local/': ''}interactions/${contractTxId}`, JSON.stringify({
    contractTxId,
    sortKey,
    lastSortKey,
    interaction: {
      ...interaction,
      sortKey,
      confirmationStatus: 'confirmed'
    }
  }), appSync)
    .then(r => {
      logger.info(`Published interaction for ${contractTxId} @ ${sortKey}`);
    })
    .catch(e => {
      logger.error('Error while publishing interaction', e);
    });
}
