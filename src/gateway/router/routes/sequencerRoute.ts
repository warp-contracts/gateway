import Router from '@koa/router';

export async function sequencerRoute(ctx: Router.RouterContext) {
  ctx.status = 301;
  ctx.set('Location', 'http://sequencer-0.warp.cc:1317')
  ctx.message = 'The sequencer has been migrated to the decentralized version'
}
