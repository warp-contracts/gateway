import * as util from "util";
import {DefaultState, Next, ParameterizedContext} from "koa";
import {GatewayContext} from "./init";

const LOG_FORMAT = '%s "%s %s HTTP/%s" %d %s';

export async function accessLogMiddleware(ctx: ParameterizedContext<DefaultState, GatewayContext, any>, next: Next): Promise<void> {
  await next();
  try {
    if (ctx.path == '/gateway/gcp/alive') {
      return;
    }
    ctx.accessLogger.debug(util.format(
        LOG_FORMAT,
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