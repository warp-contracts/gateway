import {Knex} from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import {LoggerFactory, RedStoneLogger} from "redstone-smartweave";
import {TsLogFactory} from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import {connect} from "../db/connect";
import Arweave from "arweave";
import {initGatewayDb, runGateway} from "./runGateway";
import gatewayRouter from "./router/gatewayRouter";

require("dotenv").config();

const compress = require('koa-compress');
const cors = require('@koa/cors');

declare module "koa" {
  interface BaseContext {
    gatewayDb: Knex;
    logger: RedStoneLogger;
    gatewayLogger: RedStoneLogger;
    arweave: Arweave;
  }
}

(async () => {
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
  app.use(compress({
    threshold: 2048,
    gzip: {
      flush: require('zlib').constants.Z_SYNC_FLUSH
    },
    deflate: {
      flush: require('zlib').constants.Z_SYNC_FLUSH,
    },
    br: false // disable brotli
  }))

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
