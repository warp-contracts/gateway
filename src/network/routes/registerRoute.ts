import Router from "@koa/router";

export async function registerRoute(ctx: Router.RouterContext) {
  const {nodeId, address} = ctx.request.body as {
    nodeId: string;
    address: string;
  };

  ctx.logger.info("Registering", {
    nodeId,
    address,
  });

  if (nodeId && address) {
    try {
      await ctx.db
        .insert({
          id: nodeId,
          address: address,
          status: "active",
          registerTime: Date.now(),
        })
        .into("peers")
        .onConflict(["id"])
        .merge();

      ctx.body = {status: 201, message: "registered"};
    } catch (e: any) {
      ctx.logger.error(e);
      ctx.status = 500;
      ctx.body = {message: e};
    }
  }
}
