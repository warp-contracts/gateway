import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import Koa from 'koa';
import Application from 'koa';
import bodyParser from 'koa-bodyparser';
import {
  ArweaveWrapper,
  LexicographicalInteractionsSorter,
  LoggerFactory,
  WarpFactory,
  WarpLogger,
  defaultCacheOptions,
} from 'warp-contracts';
import Arweave from 'arweave';
import gatewayRouter from './router/gatewayRouter';
import * as fs from 'fs';
import welcomeRouter from './router/welcomeRouter';
import Bundlr from '@bundlr-network/client';
import { initBundlr } from '../bundlr/connect';
import { JWKInterface } from 'arweave/node/lib/wallet';
import { runNetworkInfoCacheTask } from './tasks/networkInfoCache';
import Redis from 'ioredis';
import { PgAdvisoryLocks } from './PgAdvisoryLocks';
import { initPubSub } from 'warp-contracts-pubsub';
// @ts-ignore
import { EvmSignatureVerificationServerPlugin } from 'warp-signature/server';
import { DatabaseSource } from '../db/databaseSource';
import { accessLogMiddleware } from './accessLogMiddleware';
import { errorHandlerMiddleware } from './errorHandlerMiddleware';

const argv = yargs(hideBin(process.argv)).parseSync();
const envPath = argv.env_path || '.secrets/prod.env';
const replica = (argv.replica as boolean) || false;
const noSync = (argv.noSync as boolean) || false;
const elliptic = require('elliptic');
const EC = new elliptic.ec('secp256k1');

const cors = require('@koa/cors');

export type EnvType = 'local' | 'dev' | 'main';

export type VRF = { pubKeyHex: string; privKey: any; ec: any };

export interface GatewayContext {
  dbSource: DatabaseSource;
  logger: WarpLogger;
  sLogger: WarpLogger;
  accessLogger: WarpLogger;
  arweave: Arweave;
  bundlr: Bundlr;
  jwk: JWKInterface;
  arweaveWrapper: ArweaveWrapper;
  arweaveWrapperGqlGoldsky: ArweaveWrapper;
  vrf: VRF;
  sorter: LexicographicalInteractionsSorter;
  publisher: Redis;
  publisher_v2: Redis;
  pgAdvisoryLocks: PgAdvisoryLocks;
  env: EnvType;
  appSync?: string;
  signatureVerification: EvmSignatureVerificationServerPlugin;
  replica: boolean;
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
  LoggerFactory.INST.logLevel('debug', 'gateway');
  LoggerFactory.INST.logLevel('debug', 'sequencer');
  LoggerFactory.INST.logLevel('debug', 'PgAdvisoryLocks');
  LoggerFactory.INST.logLevel('debug', 'access');
  const logger = LoggerFactory.INST.create('gateway');
  const sLogger = LoggerFactory.INST.create('sequencer');
  const accessLogger = LoggerFactory.INST.create('access');
  const warp = WarpFactory.forMainnet();
  const warpGqlGoldsky = WarpFactory.forMainnet(
    defaultCacheOptions,
    false,
    Arweave.init({
      host: 'arweave-search.goldsky.com',
      port: 443,
      protocol: 'https',
      timeout: 20000,
      logging: false,
    }) as any
  );

  const env = process.env.ENV as string;
  if (!env) {
    logger.error(`Set 'ENV' value in ${envPath} to either 'local', 'dev' or 'main'`);
    process.exit(0);
  }
  logger.info(`🚀🚀🚀 Starting gateway in ${replica ? 'replica' : 'normal'} mode.\nnoSync = ${noSync}.\nENV: ${env}`);

  const arweave = initArweave();
  const { bundlr, jwk } = initBundlr(logger);

  const gcpDataOptions = {
    client: 'pg' as 'pg',
    url: process.env.DB_URL_GCP as string,
    ssl:
      env === 'local'
        ? undefined
        : {
            rejectUnauthorized: false,
            ca: fs.readFileSync('.secrets/ca.pem'),
            cert: fs.readFileSync('.secrets/cert.pem'),
            key: fs.readFileSync('.secrets/key.pem'),
          },
    primaryDb: true,
  };

  const healthCheckOptions = {
    ...gcpDataOptions,
    primaryDb: false,
    options: {
      pool: {
        min: 1,
        max: 2,
        createTimeoutMillis: 500,
        acquireTimeoutMillis: 500,
        idleTimeoutMillis: 500,
        reapIntervalMillis: 500,
        createRetryIntervalMillis: 100,
        propagateCreateError: false,
      },
    },
  };

  const dbSource = new DatabaseSource([gcpDataOptions], healthCheckOptions);

  const app = new Koa<Application.DefaultState, GatewayContext>();

  app.context.dbSource = dbSource;
  app.context.logger = logger;
  app.context.sLogger = sLogger;
  app.context.accessLogger = accessLogger;
  app.context.arweave = arweave;
  app.context.bundlr = bundlr;
  app.context.jwk = jwk;
  app.context.arweaveWrapper = new ArweaveWrapper(warp);
  app.context.arweaveWrapperGqlGoldsky = new ArweaveWrapper(warpGqlGoldsky);
  app.context.sorter = new LexicographicalInteractionsSorter(arweave as any);
  app.context.pgAdvisoryLocks = new PgAdvisoryLocks();
  app.context.appSync = appSync;
  app.context.signatureVerification = new EvmSignatureVerificationServerPlugin();
  app.context.replica = replica;

  app.use(errorHandlerMiddleware);
  app.use(accessLogMiddleware);

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

    if (env !== 'local') {
      const connectionOptions = readGwPubSubConfig('gw-pubsub.json');
      logger.info('Redis connection options', connectionOptions);
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
          },
        });
        const publisher2 = new Redis({
          ...connectionOptions2,
          tls: {
            ca: [process.env.GW_TLS_CA_CERT],
            checkServerIdentity: () => {
              return null;
            },
          },
        });
        await publisher2.connect();
        logger.info(`Publisher 2 status`, {
          host: connectionOptions2.host,
          status: publisher2.status,
        });
        app.context.publisher_v2 = publisher2;
      }
    }
    await runNetworkInfoCacheTask(app.context);
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
  const json = fs.readFileSync(`./.secrets/${filename}`, 'utf-8');
  return JSON.parse(json);
}
