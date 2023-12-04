import Router from '@koa/router';

const MAX_INTERACTION_DATA_ITEM_SIZE_BYTES = 20000;

const welcomeRouter = new Router();

welcomeRouter.get('/', (ctx: Router.RouterContext) => {
  ctx.body = {
    name: 'Warp Gateway',
    id: process.env.pm_id,
    maxInteractionDataItemSizeBytes: MAX_INTERACTION_DATA_ITEM_SIZE_BYTES,
  };
});

export default welcomeRouter;
