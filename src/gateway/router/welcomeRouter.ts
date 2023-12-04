import Router from '@koa/router';
import { MAX_INTERACTION_DATA_ITEM_SIZE_BYTES } from './routes/sequencerRoute_v2';

const welcomeRouter = new Router();

welcomeRouter.get('/', (ctx: Router.RouterContext) => {
  ctx.body = {
    name: 'Warp Gateway',
    id: process.env.pm_id,
    maxInteractionDataItemSizeBytes: MAX_INTERACTION_DATA_ITEM_SIZE_BYTES,
  };
});

export default welcomeRouter;
