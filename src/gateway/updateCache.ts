import {isCacheable} from "./tasks/cacheableContracts";
import {WarpLogger} from "warp-contracts";
import Router from "@koa/router";

export function updateCache(contractTxId: string, ctx: Router.RouterContext, force?: boolean) {
  const {logger} = ctx;

  if (force) {
    doUpdate(contractTxId, logger);
  } else {
    isCacheable(contractTxId, ctx).then(result => {
      if (result) {
        doUpdate(contractTxId, logger);
      } else {
        logger.info(`Contract ${contractTxId} is not marked as cacheable`);
      }
    })
  }
}

function doUpdate(contractTxId: string, logger: WarpLogger) {
  fetch(`https://tongtw88bb.execute-api.eu-north-1.amazonaws.com/prod/update?${new URLSearchParams({
    contractTxId,
  })}`, {
    headers: {
      'x-api-key': process.env.API_TOKEN as string
    }
  }).then((res) => {
    return res.ok ? res.json() : Promise.reject(res);
  }).then(res => {
    logger.info(`Response from contract registration in cache`, res);
  }).catch((error) => {
    logger.error(`Unable to register ${contractTxId} in cache`, error);
  });
}
