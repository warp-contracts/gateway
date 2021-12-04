import Router from "@koa/router";

export const peers = async (ctx: Router.RouterContext) => {
  const peers = await ctx.db
    .select(["id", "address"])
    .from("peers")
    .where("status", "active");

  ctx.logger.info(`Found ${peers.length} peers`);

  ctx.body = peers;
};

export const otherPeers = async (ctx: Router.RouterContext) => {
  const askingNode = ctx.request.query.askingNode as string;

  const peers = await ctx.db
    .select(["id", "address"])
    .from("peers")
    .where("status", "active")
    .andWhereNot("id", askingNode);

  ctx.logger.info(`Found ${peers.length} peers`);

  ctx.body = peers;
};
