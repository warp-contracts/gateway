import Router from '@koa/router';

export async function gcpAliveRoute(ctx: Router.RouterContext) {
  ctx.body = 'ok';
}
