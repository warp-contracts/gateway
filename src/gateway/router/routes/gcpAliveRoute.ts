import Router from '@koa/router';
import {getCachedNetworkData} from "../../tasks/networkInfoCache";

export async function gcpAliveRoute(ctx: Router.RouterContext) {
  const cachedNetworkData = getCachedNetworkData();
  const arBlockHeight = cachedNetworkData.cachedBlockInfo.height;

  ctx.body = {
    'gateway': 'ok',
    'ar_block_height': arBlockHeight,
    'db': await dbAccessible(ctx, arBlockHeight)
  }
}

async function dbAccessible(ctx: Router.RouterContext, arBlockHeight: number) {
  const { dbSource } = ctx;

  if (dbSource.healthCheckEnabled()) {
    try {
      const result = await dbSource.healthCheck(
        `select max(block_height) as l1_max_bh
         from interactions
         where source = 'arweave';`).timeout(500, {cancel: true});
      return {
        up: 1,
        l1_last_interaction_height: result.rows[0].l1_max_bh,
        l1_interaction_height_diff: arBlockHeight - result.rows[0].l1_max_bh
      }
    } catch (e: any) {
      return {
        up: 0,
        error: e.message
      }
    }
  }

  return 'health check disabled';
}
