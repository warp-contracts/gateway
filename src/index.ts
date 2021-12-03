import * as path from "path";

require("dotenv").config();
import { Knex } from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { connect } from "./node/db/connect";
import router from "./node/router";
import { sdk } from "./node/smartweave";
import { LoggerFactory, RedStoneLogger, SmartWeave } from "redstone-smartweave";
import { TsLogFactory } from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";

declare module "koa" {
  interface BaseContext {
    db: Knex;
    sdk: SmartWeave;
    logger: RedStoneLogger;
  }
}

(async () => {
  const port = parseInt((process.env.PORT || 4242).toString());
  const nodeId = `Node_${port}`;

  LoggerFactory.use(new TsLogFactory());
  LoggerFactory.INST.setOptions({
    displayInstanceName: true,
    instanceName: nodeId,
  });
  LoggerFactory.INST.logLevel("info");
  LoggerFactory.INST.logLevel("debug", "main");

  const logger = LoggerFactory.INST.create("main");
  logger.info(`Starting`);

  const app = new Koa();

  const db = connect(port, path.join('db'));
  app.context.db = db;
  app.context.sdk = await sdk(db);
  app.context.logger = logger;

  app.use(bodyParser());
  app.use(router.routes());

  app.listen(port);
  logger.info(`Listening on port ${port}`);
})();
