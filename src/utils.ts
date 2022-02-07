import fs from "fs";
import {JWKInterface} from "arweave/node/lib/wallet";
import {GatewayContext} from "./gateway/init";
import {Benchmark, GQLEdgeInterface, GQLResultInterface, GQLTransactionsResultInterface} from "redstone-smartweave";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readJSON(path: string): JWKInterface {
  const content = fs.readFileSync(path, "utf-8");
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`File "${path}" does not contain a valid JSON`);
  }
}
