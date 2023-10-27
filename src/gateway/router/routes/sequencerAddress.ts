import Router from '@koa/router';

export async function sequencerAddressRoute(ctx: Router.RouterContext) {
    ctx.body = {
        url: 'https://gw.warp.cc',
        type: 'centralized'
      };    
}
