import Router from '@koa/router';

export async function sequencerAddressRoute(ctx: Router.RouterContext) {
    ctx.body = {
        urls: ['https://gw.warp.cc'],
        type: 'centralized'
      };    
}
