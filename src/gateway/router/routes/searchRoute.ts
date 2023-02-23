import Router from '@koa/router';
import { Benchmark } from 'warp-contracts';
import { isTxIdValid } from '../../../utils';
import { utils } from 'ethers';
import { Knex } from 'knex';

export async function searchRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb } = ctx;

  const phrase = ctx.params.phrase.trim();
  const testnet = ctx.query.testnet as string;

  if (phrase?.length < 3) {
    ctx.body = [];
    return;
  }

  const isEthWallet = utils.isAddress(phrase);
  const validTs = isTxIdValid(phrase);

  try {
    const benchmark = Benchmark.measure();
    let result: any;
    if (isEthWallet) {
      result = await fetchCreatorOnly(gatewayDb, phrase);
    } else if (validTs) {
      result = await fetchTransaction(gatewayDb, phrase, testnet);
    } else {
      result = await fetchPst(gatewayDb, phrase, testnet);
    }

    ctx.body = result?.rows;
    logger.debug('Contracts loaded in', benchmark.elapsed());
  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}

async function fetchCreatorOnly(gatewayDb: Knex, wallet: string) {
  return gatewayDb.raw(
    `
        SELECT 5          as sort_order,
               creator_id as id,
               'creator'  as type,
               '{}'::jsonb as interaction, '' as confirmation_status,
               ''         as pst_ticker,
               ''         as pst_name
        FROM (WITH temp_creator AS (SELECT DISTINCT owner as creator_id
                                    from interactions
                                    where owner = ?
                                    UNION ALL
                                    SELECT DISTINCT owner as creator_id
                                    FROM contracts
                                    WHERE owner = ?)
              SELECT DISTINCT *
              FROM temp_creator) AS creator
    `,
    [wallet, wallet]
  );
}

async function fetchTransaction(gatewayDb: Knex, phrase: string, testnet: string) {
  return gatewayDb.raw(
    `
        SELECT 2           as sort_order,
               contract_id as id,
               'contract'  as type,
               '{}'::jsonb as interaction, '' as confirmation_status,
               ''          as pst_ticker,
               ''          as pst_name
        FROM contracts
        WHERE contract_id = ?
          AND testnet IS ${testnet == 'true' ? `NOT NULL` : 'NULL'}
        GROUP BY contract_id, type
        UNION ALL
        SELECT 3              as sort_order,
               interaction_id as id,
               'interaction'  as type,
               interaction,
               confirmation_status,
               ''             as pst_ticker,
               ''             as pst_name
        FROM interactions
        WHERE interaction_id = ?
          AND testnet IS ${testnet == 'true' ? `NOT NULL` : 'NULL'}
        UNION ALL
        SELECT 4         as sort_order,
               src_tx_id as id,
               'source'  as type,
               '{}'::jsonb as interaction, '' as confirmation_status,
               ''        as pst_ticker,
               ''        as pst_name
        FROM contracts_src
        WHERE src_tx_id = ?
          AND testnet IS ${testnet == 'true' ? `NOT NULL` : 'NULL'}
          AND src is distinct
        from 'error'
        UNION ALL
        SELECT 5          as sort_order,
               creator_id as id,
               'creator'  as type,
               '{}'::jsonb as interaction, '' as confirmation_status,
               ''         as pst_ticker,
               ''         as pst_name
        FROM (WITH temp_creator AS (SELECT DISTINCT owner as creator_id
                                    from interactions
                                    where owner = ?
                                    UNION ALL
                                    SELECT DISTINCT owner as creator_id
                                    FROM contracts
                                    WHERE owner = ?)
              SELECT DISTINCT *
              FROM temp_creator) AS creator
        ORDER BY sort_order LIMIT 30;
    `,
    [phrase, phrase, phrase, phrase, phrase]
  );
}

async function fetchPst(gatewayDb: Knex, phrase: string, testnet: string) {
  return gatewayDb.raw(
    `
        SELECT 1           as sort_order,
               contract_id as id,
               'pst'       as type,
               '{}'::jsonb as interaction, '' as confirmation_status,
               pst_ticker,
               pst_name
        FROM contracts
        WHERE pst_ticker ILIKE ? OR pst_name ILIKE ? AND testnet IS ${testnet == 'true' ? `NOT NULL` : 'NULL'}
        ORDER BY sort_order
            LIMIT 30;
    `,
    [`${phrase}%`, `${phrase}%`]
  );
}
