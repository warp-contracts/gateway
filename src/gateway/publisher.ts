import Router from '@koa/router';
import { GatewayContext } from './init';
import { publish as appSyncPublish } from 'warp-contracts-pubsub';
import { InteractionMessage } from 'warp-contracts-subscription-plugin';

const contractsChannel = 'contracts';

export function sendNotification(
  ctx: Router.RouterContext | GatewayContext,
  contractTxId: string,
  contractData?: {
    initState: any;
    srcTxId: string;
    tags: {
      name: string;
      value: string;
    }[];
  },
  interaction?: InteractionMessage
) {
  const { logger } = ctx;

  if (ctx.env === 'local') {
    logger.info('Skipping publish contract notification for local env');
    return;
  }
  try {
    if (contractData && interaction) {
      logger.error('Either interaction or contractData should be set, not both.');
    }

    const message: any = { contractTxId, test: false, source: 'warp-gw' };
    if (contractData) {
      message.initialState = contractData.initState;
      message.tags = contractData.tags;
      message.srcTxId = contractData.srcTxId;
    }
    if (interaction) {
      message.interaction = interaction;
    }

    const stringified = JSON.stringify(message);

    ctx.publisher.publish(contractsChannel, stringified);
    logger.debug(`Published ${contractsChannel}`);
  } catch (e) {
    logger.error('Error while publishing message', e);
  }
}

export function publishInteraction(
  ctx: Router.RouterContext | GatewayContext,
  contractTxId: string,
  interaction: any,
  sortKey: string,
  lastSortKey: string | null,
  functionName: string,
  source: string,
  syncTimestamp: number,
  testnet: string | null
) {
  const { logger, appSync } = ctx;

  if (!appSync || ctx.env === 'local') {
    logger.warn('App sync key not set');
    return;
  }

  const interactionToPublish = JSON.stringify({
    contractTxId,
    sortKey,
    lastSortKey,
    source,
    functionName,
    syncTimestamp,
    interaction: {
      ...interaction,
      sortKey,
      confirmationStatus: 'confirmed',
    },
  });

  publish(
    ctx,
    `interactions/${contractTxId}`,
    interactionToPublish,
    `Published interaction for contract ${contractTxId} @ ${sortKey}`,
    testnet
  );

  publish(ctx, 'interactions', interactionToPublish, `Published new interaction: ${interaction.id}`, testnet);
}

export function publishContract(
  ctx: Router.RouterContext | GatewayContext,
  contractTxId: string,
  creator: string,
  type: string,
  blockHeight: number,
  blockTimestamp: number,
  source: string,
  syncTimestamp: number,
  testnet: string | null
) {
  const contractToPublish = JSON.stringify({
    contractTxId,
    creator,
    type,
    blockHeight,
    blockTimestamp,
    source,
    syncTimestamp,
  });

  publish(ctx, 'contracts', contractToPublish, `Published contract: ${contractTxId}`, testnet);
}

function publish(
  ctx: Router.RouterContext | GatewayContext,
  channel: string,
  txToPublish: string,
  infoMessage: string,
  testnet: string | null
) {
  const { logger, appSync } = ctx;

  if (!appSync) {
    logger.warn('App sync key not set');
    return;
  }

  const prefix = ctx.env === 'main' ? '' : `${ctx.env}/`;

  appSyncPublish(`${prefix}${testnet ? 'testnet/' : ''}${channel}`, txToPublish, appSync)
    .then((r) => {
      logger.debug(infoMessage);
    })
    .catch((e) => {
      logger.error('Error while publishing transaction', e);
    });
}
