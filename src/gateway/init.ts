import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'
import {Knex} from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import {ArweaveWrapper, LoggerFactory, RedStoneLogger} from "redstone-smartweave";
import {TsLogFactory} from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import {connect} from "../db/connect";
import Arweave from "arweave";
import {runGateway} from "./runGateway";
import gatewayRouter from "./router/gatewayRouter";
import Application from "koa";
import {initGatewayDb} from "../db/schema";
import * as fs from "fs";
import cluster from 'cluster';
import welcomeRouter from "./router/welcomeRouter";
import Bundlr from "@bundlr-network/client";
import {initBundlr} from "../bundlr/connect";
import {JWKInterface} from "arweave/node/lib/wallet";
import {runNetworkInfoCacheTask} from "./tasks/networkInfoCache";

const argv = yargs(hideBin(process.argv)).parseSync();
const envPath = argv.env_path || '.secrets/prod.env';

const cors = require('@koa/cors');

export interface GatewayContext {
  gatewayDb: Knex;
  logger: RedStoneLogger;
  arweave: Arweave;
  bundlr: Bundlr;
  jwk: JWKInterface
  arweaveWrapper: ArweaveWrapper
}

(async () => {
  require("dotenv").config({
    path: envPath
  });

  let removeLock = false;

  process.on('SIGINT', () => {
    logger.warn("SIGINT");
    if (removeLock) {
      logger.debug("Removing lock file.");
      fs.rmSync('gateway.lock');
    }
    process.exit();
  });

  const port = parseInt((process.env.PORT || 5666).toString());

  //LoggerFactory.use(new TsLogFactory());
  LoggerFactory.INST.logLevel("info");
  LoggerFactory.INST.logLevel("debug", "gateway");
  const logger = LoggerFactory.INST.create("gateway");

  const arweave = initArweave();
  const {bundlr, jwk} = initBundlr(logger);

  const gatewayDb = connect();
  await initGatewayDb(gatewayDb);

  const app = new Koa<Application.DefaultState, GatewayContext>();
  app.context.gatewayDb = gatewayDb;
  app.context.logger = logger;
  app.context.arweave = arweave;
  app.context.bundlr = bundlr;
  app.context.jwk = jwk;
  app.context.arweaveWrapper = new ArweaveWrapper(arweave);

  app.use(cors({
    async origin() {
      return '*';
    },
  }));
  app.use(bodyParser());

  app.use(gatewayRouter.routes());
  app.use(gatewayRouter.allowedMethods());

  app.use(welcomeRouter.routes());
  app.use(welcomeRouter.allowedMethods());

  app.listen(port);
  logger.info(`Listening on port ${port}`);

  await runNetworkInfoCacheTask(app.context);

  if (!fs.existsSync('gateway.lock')) {
    try {
      logger.debug(`Creating lock file for ${cluster.worker?.id}`);
      // note: if another process in cluster have already created the file - writing here
      // will fail thanks to wx flags. https://stackoverflow.com/a/31777314
      fs.writeFileSync('gateway.lock', "" + cluster.worker?.id, {flag: 'wx'});
      removeLock = true;

      // note: only one worker in cluster runs the gateway tasks
      // all workers in cluster run the http server
      await runGateway(app.context);
    } catch (e: any) {
      logger.error('Error from gateway', e);
    }
  }
})();

function initArweave(): Arweave {
  return Arweave.init({
    host: "arweave.net",
    port: 443,
    protocol: "https",
    timeout: 20000,
    logging: false,
  });
}
