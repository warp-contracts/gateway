import Router from "@koa/router";

export const unregister = async (ctx: Router.RouterContext) => {
  const { nodeId } = ctx.request.body as {
    nodeId: string;
  };

  ctx.logger.info("Unregistering", {
    nodeId,
  });

  if (nodeId) {
    try {
      const updated = await ctx
        .db("peers")
        .where("id", nodeId)
        .update("status", "not-active");

      if (updated.length === 0) {
        ctx.status = 404;
        ctx.body = { status: 404, message: "Not found" };
      } else {
        ctx.body = { status: 200, message: "Unregistered" };
      }
    } catch (e: any) {
      ctx.logger.error(e);
      ctx.status = 500;
      ctx.body = { status: 500, message: e };
    }
  }
};
