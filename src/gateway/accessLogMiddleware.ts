import * as util from "util";
import {format} from 'date-fns'
import {DefaultState, Next, ParameterizedContext} from "koa";
import {GatewayContext} from "./init";

const LOG_FORMAT = '%s - - [%s] "%s %s HTTP/%s" %d %s\n';
const DATE_FORMAT = 'd/MMM/yyyy:HH:mm:ss xx';

export async function accessLogMiddleware(ctx: ParameterizedContext<DefaultState, GatewayContext, any>, next: Next): Promise<void> {
  await next();
  try {
    ctx.accessLogger.debug(util.format(
        LOG_FORMAT,
        ctx.ip,
        format(new Date(), DATE_FORMAT),
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