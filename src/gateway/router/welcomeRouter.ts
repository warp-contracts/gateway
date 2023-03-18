import Router from '@koa/router';

const welcomeRouter = new Router();

welcomeRouter.get('/', (ctx: Router.RouterContext) => {
  ctx.body = {
    name: 'Warp Gateway',
    id: process.env.pm_id,
  };
});

export default welcomeRouter;
