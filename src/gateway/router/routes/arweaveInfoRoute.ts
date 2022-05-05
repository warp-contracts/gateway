import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";
import {cachedNetworkInfo} from "../../tasks/networkInfoCache";

export async function arweaveInfoRoute(ctx: Router.RouterContext) {
  const {logger} = ctx;

  const result = cachedNetworkInfo;
  if (result == null) {
    logger.error("Network info not yet available.");
    ctx.status = 500;
    ctx.body = {message: "Network info not yet available."};
  } else {
    ctx.body = {
      ...result
    }
  }
}
