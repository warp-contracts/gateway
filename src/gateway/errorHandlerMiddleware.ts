import * as util from "util";
import {DefaultState, Next, ParameterizedContext} from "koa";
import {GatewayContext} from "./init";

const ERROR_LOG_FORMAT = '[%s][%s]: %s %s';

export class GatewayError extends Error {
  constructor(message: string, readonly status: number = 500, readonly properties: any = null, readonly log = true) {
    super(message);
    this.name = 'GatewayError'
  }
}

export async function errorHandlerMiddleware(ctx: ParameterizedContext<DefaultState, GatewayContext, any>, next: Next): Promise<void> {
  try {
    await next();
  } catch (err: any) {
    if (err.name == 'GatewayError') {
      ctx.status = err.status;
      ctx.message = `[${ctx.state.requestId}]: ${err.message}`;
      if (err.log) {
        ctx.logger.error(util.format(
          ERROR_LOG_FORMAT,
          ctx.state.requestId,
          `${ctx.path}${ctx.search}`,
          err.message,
          err.properties ? JSON.stringify(err.properties): ''
        ), err);
      }
    } else {
      ctx.status = 500;
      ctx.message = `Unknown gateway error ${err?.message || err}`;
      ctx.logger.error(util.format(
        ERROR_LOG_FORMAT,
        ctx.state.requestId,
        `${ctx.path}${ctx.search}`,
        err.message || err
      ), err);
    }
  }
}
