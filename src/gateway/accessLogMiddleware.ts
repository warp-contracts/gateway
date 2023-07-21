import * as util from "util";
import { v4 as uuidv4 } from 'uuid';
import {DefaultState, Next, ParameterizedContext} from "koa";
import {GatewayContext} from "./init";

const LOG_FORMAT = '%s %s "%s %s HTTP/%s" %d %s %s[ms]';

export async function accessLogMiddleware(ctx: ParameterizedContext<DefaultState, GatewayContext, any>, next: Next): Promise<void> {
  ctx.state.requestId = uuidv4();
  const t0 = performance.now();
  await next();
  const t1 = performance.now();
  try {
    if (ctx.path == '/gateway/gcp/alive' || ctx.path == '/gateway/arweave/info') {
      return;
    }
    ctx.accessLogger.debug(util.format(
        LOG_FORMAT,
        ctx.state.requestId,
        ctx.ip,
        ctx.method,
        `${ctx.path}${ctx.search}`,
        ctx.req.httpVersion,
        ctx.status,
        ctx.length ? ctx.length.toString() : '-',
        (t1 - t0).toFixed(3)
      )
    );
  } catch (err: any) {
    console.error(err);
  }
}
