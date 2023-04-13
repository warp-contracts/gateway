import * as util from "util";
import { v4 as uuidv4 } from 'uuid';
import {DefaultState, Next, ParameterizedContext} from "koa";
import {GatewayContext} from "./init";

const LOG_FORMAT = '%s %s "%s %s HTTP/%s" %d %s';

export async function accessLogMiddleware(ctx: ParameterizedContext<DefaultState, GatewayContext, any>, next: Next): Promise<void> {
  ctx.state.requestId = uuidv4();
  await next();
  try {
    if (ctx.path == '/gateway/gcp/alive' || ctx.path == '/gateway/arweave/info') {
      return;
    }
    ctx.accessLogger.debug(util.format(
        LOG_FORMAT,
        ctx.state.requestId,
        ctx.ip,
        ctx.method,
        ctx.path,
        ctx.req.httpVersion,
        ctx.status,
        ctx.length ? ctx.length.toString() : '-'
      )
    );
  } catch (err: any) {
    console.error(err);
  }
}
