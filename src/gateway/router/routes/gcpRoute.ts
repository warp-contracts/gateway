import Router from '@koa/router';

export async function gcpRoute(ctx: Router.RouterContext) {
  ctx.body = 'hello from gcp';
}
