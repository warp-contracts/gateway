import Router from "@koa/router";
import {GatewayContext} from "./init";
import {publish as appSyncPublish} from "warp-contracts-pubsub";
import {InteractionMessage} from "warp-contracts-subscription-plugin";

const contractsChannel = 'contracts';

export function sendNotification(
  ctx: Router.RouterContext | GatewayContext,
  contractTxId: string,
  contractData?: { initState: any, tags: {
      name: string;
      value: string;
    }[] },
  interaction?: InteractionMessage) {
  const {logger} = ctx;

  if (ctx.localEnv) {
    logger.info('Skipping publish contract notification for local env');
    return;
  }
  try {
    if (contractData && interaction) {
      logger.error('Either interaction or contractData should be set, not both.');
    }

    const message: any = {contractTxId, test: false, source: 'warp-gw'};
    if (contractData) {
      message.initialState = contractData.initState;
      message.tags = contractData.tags;
    }
    if (interaction) {
      message.interaction = interaction;
    }

    ctx.publisher.publish(contractsChannel, JSON.stringify(message));
    logger.info(`Published ${contractsChannel}`);
    /*ctx.publisher_v2.publish(contractsChannel, JSON.stringify(message));
    logger.info(`Published v2 ${contractsChannel}`);*/
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
