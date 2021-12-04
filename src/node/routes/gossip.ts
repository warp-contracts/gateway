import Router from "@koa/router";

export const gossipRoute = async (ctx: Router.RouterContext) => {
  const { type, contractId, height } = ctx.request.body as {
    type: string;
    contractId: string;
    height: number;
  };

  if (type === "query") {
    // evaluate contract
    await ctx.sdk.contract(contractId).readState(height);

    // load evaluated hash from node's db
    const result = (
      await ctx.db
        .select("hash")
        .from("states")
        .where("contract_id", contractId)
        .andWhere("height", height)
        .limit(1)
    )[0];
    ctx.body = result.hash;
  }

};
