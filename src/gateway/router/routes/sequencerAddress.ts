import Router from '@koa/router';

export async function sequencerAddressRoute(ctx: Router.RouterContext) {
    ctx.body = {
        url: 'http://sequencer-0.warp.cc:1317',
        type: 'decentralized'
      };    
}
