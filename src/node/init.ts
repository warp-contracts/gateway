import * as path from "path";

require("dotenv").config();
import { Knex } from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { connect } from "../db/connect";
import nodeRouter from "./nodeRouter";
import { sdk } from "./smartweave";
import { LoggerFactory, RedStoneLogger, SmartWeave } from "redstone-smartweave";
import { TsLogFactory } from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import axios from "axios";

declare module "koa" {
  interface BaseContext {
    db: Knex;
    sdk: SmartWeave;
    logger: RedStoneLogger;
    whoami: string;
    network: string;
  }
}

export const unregister = async (nodeId: string, networkAddress: string) => {
  await axios.post(`${networkAddress}/unregister`, {
    nodeId,
  });
};

(async () => {
  const port = parseInt((process.env.PORT || 4242).toString());
  const nodeId = `Node_${port}`;
  const address = `http://localhost:${port}`;
  const networkAddress = `http://localhost:5666`;

  LoggerFactory.use(new TsLogFactory());
  LoggerFactory.INST.setOptions({
    displayInstanceName: true,
    instanceName: nodeId,
    moduleName: false,
  });

  LoggerFactory.INST.logLevel("info");
  LoggerFactory.INST.logLevel("debug", "node");

  const logger = LoggerFactory.INST.create("node");
  logger.info(`Starting`);

  const app = new Koa();

  const db = connect(port, path.join("db", "peers"));
  app.context.db = db;
  app.context.sdk = await sdk(db);
  app.context.logger = logger;
  app.context.whoami = nodeId;
  app.context.network = networkAddress;

  app.use(bodyParser());
  app.use(nodeRouter.routes());

  app.listen(port);

  await axios.post(`${networkAddress}/register`, {
    nodeId,
    address,
  });

  logger.info("Registered");

  process.on("exit", async () => {
    await unregister(nodeId, networkAddress);
    process.exit();
  });
  process.on("SIGINT", async () => {
    await unregister(nodeId, networkAddress);
    process.exit();
  });

  logger.info(`Listening on port ${port}`);
})();
