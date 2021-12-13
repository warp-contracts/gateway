import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'
import {Knex} from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import {LoggerFactory, RedStoneLogger} from "redstone-smartweave";
import {TsLogFactory} from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import {connect} from "../db/connect";
import Arweave from "arweave";
import {initGatewayDb, runGateway} from "./runGateway";
import gatewayRouter from "./router/gatewayRouter";

const argv = yargs(hideBin(process.argv)).parseSync();
const envPath = argv.env_path || '.secrets/.env';

const cors = require('@koa/cors');

// TODO: why do we delcare a module for an external dependency
// If there are no types, I'd put it in decs.d.ts
// More info: https://medium.com/@steveruiz/using-a-javascript-library-without-type-declarations-in-a-typescript-project-3643490015f3
declare module "koa" {
  interface BaseContext {
    gatewayDb: Knex;
    logger: RedStoneLogger;
    gatewayLogger: RedStoneLogger;
    arweave: Arweave;
  }
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

  const app = new Koa();
  app.context.gatewayDb = gatewayDb;
  app.context.gatewayLogger = gatewayLogger;
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
    gatewayLogger.error('Error from gateway', e.message);
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
