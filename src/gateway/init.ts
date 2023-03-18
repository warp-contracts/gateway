import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Knex } from 'knex';
import Koa from 'koa';
import Application from 'koa';
import bodyParser from 'koa-bodyparser';
import { ArweaveWrapper, LexicographicalInteractionsSorter, LoggerFactory, WarpLogger } from 'warp-contracts';
import { connect } from '../db/connect';
import Arweave from 'arweave';
import { runGatewayTasks } from './runGatewayTasks';
import gatewayRouter from './router/gatewayRouter';
import { initGatewayDb } from '../db/schema';
import * as fs from 'fs';
import cluster from 'cluster';
import welcomeRouter from './router/welcomeRouter';
import Bundlr from '@bundlr-network/client';
import { initBundlr } from '../bundlr/connect';
import { JWKInterface } from 'arweave/node/lib/wallet';
import { runNetworkInfoCacheTask } from './tasks/networkInfoCache';
import path from 'path';
import Redis from 'ioredis';
import { LastTxSync } from './LastTxSyncer';
import { initPubSub } from 'warp-contracts-pubsub';
// @ts-ignore
import { EvmSignatureVerificationServerPlugin } from 'warp-signature/server';

const argv = yargs(hideBin(process.argv)).parseSync();
const envPath = argv.env_path || '.secrets/prod.env';
const replica = (argv.replica as boolean) || false;
console.log('argv.noSync', argv.noSync);
const noSync = (argv.noSync as boolean) || false;
const localEnv = (argv.local as boolean) || false;
const elliptic = require('elliptic');
const EC = new elliptic.ec('secp256k1');

const cors = require('@koa/cors');

export type VRF = { pubKeyHex: string; privKey: any; ec: any };

export interface GatewayContext {
  gatewayDb: Knex;
  logger: WarpLogger;
  sLogger: WarpLogger;
  arweave: Arweave;
  bundlr: Bundlr;
  jwk: JWKInterface;
  arweaveWrapper: ArweaveWrapper;
  vrf: VRF;
  sorter: LexicographicalInteractionsSorter;
  publisher: Redis;
  publisher_v2: Redis;
  lastTxSync: LastTxSync;
  localEnv: boolean;
  appSync?: string;
  signatureVerification: EvmSignatureVerificationServerPlugin;
}

(async () => {
  require('dotenv').config({
    path: envPath,
  });

  let removeLock = false;

  initPubSub();

  process.on('SIGINT', () => {
    logger.warn('SIGINT');
    if (removeLock) {
      logger.debug('Removing lock file.');
      fs.rmSync('gateway.lock');
    }
    process.exit();
  });

  const port = parseInt((process.env.PORT || 5666).toString());
  const appSync = process.env.APP_SYNC;

  LoggerFactory.INST.logLevel('info');
  LoggerFactory.INST.logLevel('info', 'gateway');
  LoggerFactory.INST.logLevel('debug', 'sequencer');
  LoggerFactory.INST.logLevel('debug', 'LastTxSync');
  const logger = LoggerFactory.INST.create('gateway');
  const sLogger = LoggerFactory.INST.create('sequencer');

  logger.info(`🚀🚀🚀 Starting gateway in ${replica ? 'replica' : 'normal'} mode. noSync = ${noSync}`);

  const arweave = initArweave();
  const { bundlr, jwk } = initBundlr(logger);

  const gatewayDb = connect();
  await initGatewayDb(gatewayDb);

  const app = new Koa<Application.DefaultState, GatewayContext>();
  const signatureVerification = new EvmSignatureVerificationServerPlugin();

  app.context.gatewayDb = gatewayDb;
  app.context.logger = logger;
  app.context.sLogger = sLogger;
  app.context.arweave = arweave;
  app.context.bundlr = bundlr;
  app.context.jwk = jwk;
  app.context.arweaveWrapper = new ArweaveWrapper(arweave);
  app.context.sorter = new LexicographicalInteractionsSorter(arweave);
  app.context.lastTxSync = new LastTxSync();
  app.context.localEnv = localEnv;
  app.context.appSync = appSync;
  app.context.signatureVerification = signatureVerification;

  app.use(
    cors({
      async origin() {
        return '*';
      },
    })
  );
  app.use(
    bodyParser({
      jsonLimit: '2mb',
    })
  );

  app.use(bodyParser());

  const gwRouter = gatewayRouter(replica);
  app.use(gwRouter.routes());
  app.use(gwRouter.allowedMethods());

  app.use(welcomeRouter.routes());
  app.use(welcomeRouter.allowedMethods());

  app.listen(port);
  logger.info(`Listening on port ${port}`);

  // note: replica only serves "GET" requests and does not run any tasks
  if (!replica) {
    app.context.vrf = {
      pubKeyHex: fs.readFileSync('./vrf-pub-key.txt', 'utf8'),
      privKey: EC.keyFromPrivate(fs.readFileSync('./.secrets/vrf-priv-key.txt', 'utf8'), 'hex').getPrivate(),
      ec: EC,
    };

    logger.info('vrf', app.context.vrf);

    const connectionOptions = readGwPubSubConfig('gw-pubsub.json');
    if (connectionOptions) {
      const publisher = new Redis(connectionOptions);
      await publisher.connect();
      logger.info(`Publisher status`, {
        host: connectionOptions.host,
        status: publisher.status,
      });
      app.context.publisher = publisher;
    }

    // temporary..
    const connectionOptions2 = readGwPubSubConfig('gw-pubsub_2.json');
    if (connectionOptions2) {
      console.log({
        ...connectionOptions2,
        tls: {
          ca: [process.env.GW_TLS_CA_CERT],
          checkServerIdentity: () => {
            return null;
          },
        }
      });

      const publisher2 = new Redis({
        ...connectionOptions2,
        tls: {
          ca: [process.env.GW_TLS_CA_CERT],
          checkServerIdentity: () => { return null; },
        }
      });
      await publisher2.connect();
      logger.info(`Publisher 2 status`, {
        host: connectionOptions2.host,
        status: publisher2.status,
      });
      app.context.publisher_v2 = publisher2;
    }

    if (!fs.existsSync('gateway.lock')) {
      await runNetworkInfoCacheTask(app.context);

      if (!noSync) {
        try {
          logger.info(`Creating lock file for ${cluster.worker?.id}`);
          // note: if another process in cluster have already created the file - writing here
          // will fail thanks to wx flags. https://stackoverflow.com/a/31777314
          fs.writeFileSync('gateway.lock', '' + cluster.worker?.id, {flag: 'wx'});
          removeLock = true;

          // note: only one worker in cluster runs the gateway tasks
          // all workers in cluster run the http server
          if (!localEnv) {
            logger.info(`Starting gateway tasks for ${cluster.worker?.id}`);
            await runGatewayTasks(app.context);
          }
        } catch (e: any) {
          logger.error('Error from gateway', e);
        }
      }
    }
  }
})();

function initArweave(): Arweave {
  return Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https',
    timeout: 20000,
    logging: false,
  });
}

function readGwPubSubConfig(filename: string) {
  const pubSubConfigPath = path.join('.secrets', filename);
  if (fs.existsSync(pubSubConfigPath)) {
    const json = fs.readFileSync(pubSubConfigPath, 'utf-8');
    return JSON.parse(json);
  } else {
    return false;
  }
}
