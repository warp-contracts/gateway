import Router from '@koa/router';
import {Knex} from "knex";
import {isTxIdValid} from "../../../utils";
import {Benchmark} from "warp-contracts";

const MAX_INTERACTIONS_PER_PAGE = 50000;

function loadInteractionsForSrcTx(
  gatewayDb: Knex, group: string, fromSortKey: string, limit: number, offset: number) {
  const bindings: any[] = [];
  bindings.push(group);
  fromSortKey && bindings.push(fromSortKey);
  bindings.push(limit);
  bindings.push(offset);

  const query = `
      SELECT i.contract_id as "contractId",
             i.interaction,
             i.confirmation_status,
             i.sort_key
      FROM interactions i
               JOIN contracts c ON i.contract_id = c.contract_id
      WHERE c.src_tx_id = ?
        AND i.confirmation_status IN ('confirmed', 'not_processed')
        ${fromSortKey ? ' AND sort_key > ?' : ''}
      ORDER BY i.contract_id ASC, i.sort_key ASC
      LIMIT ? OFFSET ?`;

  return gatewayDb.raw(query, bindings);
}

function loadInteractionsForGroup(
  gatewayDb: Knex, group: string, fromSortKey: string, limit: number, offset: number) {
  const bindings: any[] = [];
  if (group != 'all_pst') {
    throw new Error(`Unknown group ${group}`);
  }

  fromSortKey && bindings.push(fromSortKey);
  bindings.push(limit);
  bindings.push(offset);

  const query = `
      SELECT i.contract_id as "contractId",
             i.interaction,
             i.confirmation_status,
             i.sort_key
      FROM interactions i
               JOIN contracts c ON i.contract_id = c.contract_id
               JOIN contracts_src s ON s.src_tx_id = c.src_tx_id
      WHERE c.type = 'pst'
        AND c.content_type = 'application/json'
        AND i.contract_id NOT IN (
                                  'LkfzZvdl_vfjRXZOPjnov18cGnnK3aDKj0qSQCgkCX8', /* kyve  */
                                  'l6S4oMyzw_rggjt4yt4LrnRmggHQ2CdM1hna2MK4o_c', /* kyve  */
                                  'B1SRLyFzWJjeA0ywW41Qu1j7ZpBLHsXSSrWLrT3ebd8', /* kyve  */
                                  'cETTyJQYxJLVQ6nC3VxzsZf1x2-6TW2LFkGZa91gUWc', /* koi   */
                                  'QA7AIFVx1KBBmzC7WUNhJbDsHlSJArUT0jWrhZMZPS8', /* koi   */
                                  '8cq1wbjWHNiPg7GwYpoDT2m9HX99LY7tklRQWfh1L6c', /* kyve  */
                                  'NwaSMGCdz6Yu5vNjlMtCNBmfEkjYfT-dfYkbQQDGn5s', /* koi   */
                                  'qzVAzvhwr1JFTPE8lIU9ZG_fuihOmBr7ewZFcT3lIUc', /* koi   */
                                  'OFD4GqQcqp-Y_Iqh8DN_0s3a_68oMvvnekeOEu_a45I', /* kyve  */
                                  'CdPAQNONoR83Shj3CbI_9seC-LqgI1oLaRJhSwP90-o', /* koi   */
                                  'dNXaqE_eATp2SRvyFjydcIPHbsXAe9UT-Fktcqs7MDk' /* kyve  */)
        AND c.src_tx_id NOT IN ('a7IR-xvPkBtcYUBZXd8z-Tu611VeJH33uEA5XiFUNA') /* Hoh */
        AND i.confirmation_status IN ('confirmed', 'not_processed')
        AND ((s.src_content_type = 'application/javascript'
          AND (s.src NOT LIKE '%readContractState%' AND s.src NOT LIKE '%unsafeClient%'))
          OR s.src_content_type = 'application/wasm') 
          ${fromSortKey ? ' AND sort_key > ?' : ''}
      ORDER BY i.contract_id ASC, i.sort_key ASC
      LIMIT ? OFFSET ?;
  `;

  return gatewayDb.raw(query, bindings);
}

export async function interactionsContractGroupsRoute(ctx: Router.RouterContext) {
  const {gatewayDb, logger} = ctx;
  const {group, fromSortKey, page, limit} = ctx.query;
  const parsedPage = page ? parseInt(page as string) : 1;
  const parsedLimit = limit
    ? Math.min(parseInt(limit as string), MAX_INTERACTIONS_PER_PAGE)
    : MAX_INTERACTIONS_PER_PAGE;
  const offset = (parsedPage - 1) * parsedLimit;
  const parsedGroup = group as string;

  let result;

  try {
    const benchmark = Benchmark.measure();
    result = isTxIdValid(parsedGroup)
      ? await loadInteractionsForSrcTx(gatewayDb, parsedGroup, fromSortKey as string, parsedLimit, offset)
      : await loadInteractionsForGroup(gatewayDb, parsedGroup, fromSortKey as string, parsedLimit, offset);

    logger.info(`Loading contract groups interactions: ${benchmark.elapsed()}`);

    const grouped: any = {};
    for (let row of result?.rows) {
      if (!grouped[row.contractId]) {
        grouped[row.contractId] = [];
      }
      grouped[row.contractId].push(
        {
          ...row.interaction,
          confirmationStatus: row.confirmation_status,
          sortKey: row.sort_key,
        }
      )
    }

    ctx.body = {
      paging: {
        limit: parsedLimit,
        items: result?.rows.length,
        page: parsedPage
      },

      interactions: grouped,
    };
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
