import * as path from "path";
import {Knex} from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import {LoggerFactory, RedStoneLogger} from "redstone-smartweave";
import {TsLogFactory} from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import {connect} from "../db/connect";
import networkRouter from "./routes/networkRouter";
import {initArweave} from "../node/arweave";
import Arweave from "arweave";
import {gateway, initGatewayDb} from "./gateway/gateway";
import gatewayRouter from "./gateway/gatewayRouter";

require("dotenv").config();

const compress = require('koa-compress')

async function init(db: Knex) {
  if (!(await db.schema.hasTable("peers"))) {
    await db.schema.createTable("peers", (table) => {
      table.string("id", 64).primary();
      table.string("address").notNullable().unique().index();
      table.string("status").notNullable().index();
      table.json("metrics");
      table.timestamp("registerTime").notNullable();
    });
  }
}

declare module "koa" {
  interface BaseContext {
    networkDb: Knex;
    gatewayDb: Knex;
    logger: RedStoneLogger;
    gatewayLogger: RedStoneLogger;
    arweave: Arweave;
  }
}

(async () => {
  const port = parseInt((process.env.PORT || 5666).toString());
  const networkId = `Network_${port}`;

  LoggerFactory.use(new TsLogFactory());
  LoggerFactory.INST.logLevel("info");
  LoggerFactory.INST.logLevel("debug", "network");
  LoggerFactory.INST.logLevel("debug", "gateway");

  const networkLogger = LoggerFactory.INST.create("network");
  const gatewayLogger = LoggerFactory.INST.create("gateway");
  networkLogger.info(`Starting`);

  const app = new Koa();

  const db = connect(port, "network", path.join("db", "network"));
  await init(db);

  const gatewayDb = connect(port, "gateway", path.join("db", "network"));
  await initGatewayDb(gatewayDb);

  const arweave = initArweave();
  app.context.db = db;
  app.context.gatewayDb = gatewayDb;
  app.context.logger = networkLogger;
  app.context.gatewayLogger = gatewayLogger;
  app.context.arweave = arweave;

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
  app.use(networkRouter.routes());
  app.use(networkRouter.allowedMethods());
  app.use(gatewayRouter.routes());
  app.use(gatewayRouter.allowedMethods());

  app.listen(port);
  networkLogger.info(`Listening on port ${port}`);

  try {
    await gateway(app.context);
  } catch (e: any) {
    networkLogger.error('Error from gateway', e.message);
  }
})();
