import * as path from "path";
import { Knex } from "knex";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { connect } from "../db/connect";
import nodeRouter from "./nodeRouter";
import {
  LoggerFactory,
  RedStoneLogger,
  SmartWeave,
  SmartWeaveNodeFactory,
} from "redstone-smartweave";
import { TsLogFactory } from "redstone-smartweave/lib/cjs/logging/node/TsLogFactory";
import axios from "axios";
import { initArweave } from "./arweave";
import Arweave from "arweave";
import { blockListener, initBlocksDb } from "./blockListener";

require("dotenv").config();

declare module "koa" {
  interface BaseContext {
    db: Knex;
    blocksDb: Knex;
    sdk: SmartWeave;
    logger: RedStoneLogger;
    whoami: NodeData;
    network: string;
    arweave: Arweave;
  }
}

export type NodeData = {
  id: string;
  address: string;
};

export const register = async (
  nodeId: string,
  address: string,
  networkAddress: string
) => {
  // TODO: retries
  await axios.post(`${networkAddress}/register`, {
    nodeId,
    address,
  });
};

export const unregister = async (nodeId: string, networkAddress: string) => {
  // TODO: retries
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
  LoggerFactory.INST.logLevel("error");
  LoggerFactory.INST.logLevel("debug", "node");
  const logger = LoggerFactory.INST.create("node");

  logger.info(`====== Starting ======`);

  const app = new Koa();
  const db = connect(port, "state", path.join("db", "peers"));
  const blocksDb = connect(port, "blocks", path.join("db", "peers"));
  const arweave = initArweave();

  app.context.db = db;
  app.context.blocksDb = blocksDb;
  app.context.arweave = arweave;
  app.context.sdk = await SmartWeaveNodeFactory.knexCached(arweave, db);
  app.context.logger = logger;
  app.context.whoami = { id: nodeId, address };
  app.context.network = networkAddress;

  app.use(bodyParser());
  app.use(nodeRouter.routes());

  app.listen(port);

  await register(nodeId, address, networkAddress);

  await initBlocksDb(blocksDb);
  await blockListener(app.context);

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
