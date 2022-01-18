import {RedStoneLogger} from "redstone-smartweave";
import Bundlr from "@bundlr-network/client";
import fs from "fs";
import {TaskRunner} from "../gateway/tasks/TaskRunner";
import {GatewayContext} from "../gateway/init";

const BUNDLR_CHECK_INTERVAL = 3600000;

export async function runBundlrCheck(context: GatewayContext) {
  await TaskRunner
    .from("[bundlr balance check]", checkBalance, context)
    .runSyncEvery(BUNDLR_CHECK_INTERVAL, true);
}

export function initBundlr(logger: RedStoneLogger): Bundlr {
  const jwk = JSON.parse(fs.readFileSync(".secrets/redstone-jwk.json").toString());
  const bundlr = new Bundlr("https://node1.bundlr.network/", "arweave", jwk);
  logger.info("Running bundlr on", {
    address: bundlr.address,
    currency: bundlr.currency
  });

  return bundlr;
}

async function checkBalance(context: GatewayContext) {
  const {bundlr, logger} = context;
  logger.debug("Checking Bundlr balance");

  // Check your balance
  const balance = await bundlr.getLoadedBalance();
  logger.debug("Current Bundlr balance", balance);


  // If balance is < 0.5 AR
  if (balance.isLessThan(5e11)) {
    logger.debug("Funding Bundlr");
    // Fund your account with 0.5 AR
    //const fundResult = await bundlr.fund(5e11);
    //logger.debug("Fund result", fundResult);
  }
}
