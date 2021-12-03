import Router from "@koa/router";
import { snowball } from "../snowball";

export const currentState = async (ctx: Router.RouterContext) => {
  const { contractId } = ctx.request.body as { contractId: string };

  if (contractId) {
    ctx.logger.info(`Deploying ${contractId}`);

    ctx.body = { status: 201, message: "Received" };

    // evaluate contract
    await ctx.sdk.contract(contractId).readState();

    // load evaluated hash from db
    const result = (
      await ctx.db
        .select("height", "state", "hash")
        .from("states")
        .where("contract_id", contractId)
        .orderBy("height", "desc")
        .limit(1)
    )[0];

    ctx.logger.debug("Received", {
      contractId,
      hash: result.hash,
      height: result.height,
    });

    await snowball(ctx, contractId, result.height, result.hash);
  }
};
