import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Knex } from 'knex';
import Koa from 'koa';
import Application from 'koa';
import bodyParser from 'koa-bodyparser';
import { ArweaveWrapper, LexicographicalInteractionsSorter, LoggerFactory, RedStoneLogger } from 'redstone-smartweave';
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

const argv = yargs(hideBin(process.argv)).parseSync();
const envPath = argv.env_path || '.secrets/prod.env';
const replica = argv.replica || false;
const elliptic = require('elliptic');
const EC = new elliptic.ec('secp256k1');

const cors = require('@koa/cors');

export type VRF = { pubKeyHex: string; privKey: any; ec: any };

export interface GatewayContext {
  gatewayDb: Knex;
  logger: RedStoneLogger;
  sLogger: RedStoneLogger;
  arweave: Arweave;
  bundlr: Bundlr;
  jwk: JWKInterface;
  arweaveWrapper: ArweaveWrapper;
  vrf: VRF;
  sorter: LexicographicalInteractionsSorter;
}

(async () => {
  require('dotenv').config({
    path: envPath,
  });

  let removeLock = false;

  process.on('SIGINT', () => {
    logger.warn('SIGINT');
    if (removeLock) {
      logger.debug('Removing lock file.');
      fs.rmSync('gateway.lock');
    }
    process.exit();
  });

  const port = parseInt((process.env.PORT || 5666).toString());

  LoggerFactory.INST.logLevel('info');
  LoggerFactory.INST.logLevel('debug', 'gateway');
  LoggerFactory.INST.logLevel('debug', 'sequencer');
  const logger = LoggerFactory.INST.create('gateway');
  const sLogger = LoggerFactory.INST.create('sequencer');

  logger.info(`🚀🚀🚀 Starting gateway in ${replica ? 'replica' : 'normal'} mode.`);

  const arweave = initArweave();
  const { bundlr, jwk } = initBundlr(logger);

  const gatewayDb = connect();
  await initGatewayDb(gatewayDb);

  const app = new Koa<Application.DefaultState, GatewayContext>();
  app.context.gatewayDb = gatewayDb;
  app.context.logger = logger;
  app.context.sLogger = sLogger;
  app.context.arweave = arweave;
  app.context.bundlr = bundlr;
  app.context.jwk = jwk;
  app.context.arweaveWrapper = new ArweaveWrapper(arweave);
  app.context.sorter = new LexicographicalInteractionsSorter(arweave);

  app.use(
    cors({
      async origin() {
        return '*';
      },
    })
  );
  app.use(bodyParser());

  app.use(gatewayRouter.routes());
  app.use(gatewayRouter.allowedMethods());

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

    if (!fs.existsSync('gateway.lock')) {
      try {
        logger.debug(`Creating lock file for ${cluster.worker?.id}`);
        // note: if another process in cluster have already created the file - writing here
        // will fail thanks to wx flags. https://stackoverflow.com/a/31777314
        fs.writeFileSync('gateway.lock', '' + cluster.worker?.id, { flag: 'wx' });
        removeLock = true;

        await runNetworkInfoCacheTask(app.context);
        // note: only one worker in cluster runs the gateway tasks
        // all workers in cluster run the http server
        await runGatewayTasks(app.context);
      } catch (e: any) {
        logger.error('Error from gateway', e);
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
