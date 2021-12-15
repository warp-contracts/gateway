import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'
import {Knex} from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import {LoggerFactory, RedStoneLogger} from "redstone-smartweave";
import {TsLogFactory} from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import {connect} from "../db/connect";
import Arweave from "arweave";
import {runGateway} from "./runGateway";
import gatewayRouter from "./router/gatewayRouter";
import Application from "koa";
import {initGatewayDb} from "../db/schema";

const argv = yargs(hideBin(process.argv)).parseSync();
const envPath = argv.env_path || '.secrets/prod.env';

const cors = require('@koa/cors');

export interface GatewayContext {
  gatewayDb: Knex;
  logger: RedStoneLogger;
  arweave: Arweave;
}

(async () => {
  require("dotenv").config({
    path: envPath
  });

  const port = parseInt((process.env.PORT || 5666).toString());

  LoggerFactory.use(new TsLogFactory());
  LoggerFactory.INST.logLevel("info");
  LoggerFactory.INST.logLevel("debug", "gateway");

  const arweave = initArweave();
  const gatewayLogger = LoggerFactory.INST.create("gateway");

  const gatewayDb = connect();
  await initGatewayDb(gatewayDb);

  const app = new Koa<Application.DefaultState, GatewayContext>();
  app.context.gatewayDb = gatewayDb;
  app.context.logger = gatewayLogger;
  app.context.arweave = arweave;

  app.use(cors());
  app.use(bodyParser());

  app.use(gatewayRouter.routes());
  app.use(gatewayRouter.allowedMethods());

  app.listen(port);
  gatewayLogger.info(`Listening on port ${port}`);

  try {
    await runGateway(app.context);
  } catch (e: any) {
    gatewayLogger.error('Error from gateway', e);
  }
})();

function initArweave(): Arweave {
  return Arweave.init({
    host: "arweave.net",
    port: 443,
    protocol: "https",
    timeout: 60000,
    logging: false,
  });
}
