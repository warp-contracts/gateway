import * as path from "path";
import { Knex } from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { LoggerFactory, RedStoneLogger } from "redstone-smartweave";
import { TsLogFactory } from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import { connect } from "../db/connect";
import networkRouter from "./networkRouter";

require("dotenv").config();

const init = async (db: Knex) => {
  if (!(await db.schema.hasTable("peers"))) {
    await db.schema.createTable("peers", (table) => {
      table.string("id", 64).primary();
      table.string("address").notNullable().unique().index();
      table.string("status").notNullable().index();
      table.json("metrics");
      table.timestamp("registerTime").notNullable();
    });
  }
};

declare module "koa" {
  interface BaseContext {
    db: Knex;
    logger: RedStoneLogger;
  }
}

(async () => {
  const port = parseInt((process.env.PORT || 5666).toString());
  const networkId = `Network_${port}`;

  LoggerFactory.use(new TsLogFactory());
  LoggerFactory.INST.logLevel("info");
  LoggerFactory.INST.logLevel("debug", "network");

  const logger = LoggerFactory.INST.create("network");
  logger.info(`Starting`);

  const app = new Koa();

  const db = connect(port, "network", path.join("db", "network"));
  await init(db);

  app.context.db = db;
  app.context.logger = logger;

  app.use(bodyParser());
  app.use(networkRouter.routes());

  app.listen(port);
  logger.info(`Listening on port ${port}`);
})();
