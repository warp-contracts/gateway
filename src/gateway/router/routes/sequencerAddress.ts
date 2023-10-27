import Router from '@koa/router';

export async function sequencerAddressRoute(ctx: Router.RouterContext) {
    ctx.body = {
        url: 'https://d1o5nlqr4okus2.cloudfront.net',
        type: 'centralized'
      };    
}
