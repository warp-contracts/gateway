import {cacheableContracts} from "./tasks/cacheableContracts";
import {WarpLogger} from "warp-contracts";

export function updateCache(contractTxId: string, logger: WarpLogger) {
  if (cacheableContracts.has(contractTxId)) {
    logger.debug(`Registering contract ${contractTxId} in cache`);
    fetch(`https://tongtw88bb.execute-api.eu-north-1.amazonaws.com/prod/update?${new URLSearchParams({
      contractTxId,
    })}`, {
      headers: {
        'x-api-key': process.env.API_TOKEN as string
      }
    }).then((res) => {
      return res.ok ? res.json() : Promise.reject(res);
    }).then(res => {
      logger.debug(`Response from contract registration in cache`, res);
    }).catch((error) => {
      logger.error(`Unable to register ${contractTxId} in cache`, error);
    });
  } else {
    logger.debug(`Contract ${contractTxId} is not marked as cacheable`);
  }
}
