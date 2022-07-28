import Router from '@koa/router';
import { Benchmark } from 'warp-contracts';

export async function contractSourceRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb } = ctx;

  const { id } = ctx.query;
  if (id?.length != 43) {
    ctx.body = {};
    return;
  }

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT s.src_tx_id                                                                            as "srcTxId",
                 (case when not s.owner = 'error' then s.owner else null end)                           as "owner",
                 (case when s.src_content_type = 'application/javascript' then s.src else null end)     as src,
                 (case when s.src_content_type = 'application/wasm' then s.src_binary else null end)    as "srcBinary",
                 s.src_wasm_lang                                                                        as "srcWasmLang",
                 s.bundler_src_tx_id                                                                    as "bundlerSrcTxId",
                 s.src_tx                                                                               as "srcTx"
          FROM contracts_src s 
          WHERE src_tx_id = ?;
      `,
      [id]
    );

    const contracts: any = await gatewayDb.raw(
      `
            SELECT  c.contract_id                                                                       as "contractId",
                    c.owner                                                                             as "owner",
                    c.bundler_contract_tx_id                                                            as "bundlerTxId",
                    c.block_height                                                                      as "blockHeight",
                    c.block_timestamp                                                                   as "blockTimestamp",
                    count(i.contract_id)                                                                as "interactions",
                    count(case when i.confirmation_status = 'corrupted' then 1 end)                     as "corrupted",
                    count(case when i.confirmation_status = 'confirmed' then 1 end)                     as "confirmed"
            FROM contracts c
            LEFT JOIN interactions i
            ON c.contract_id = i.contract_id
            WHERE src_tx_id = ?
            AND c.type != 'error'
            GROUP BY c.contract_id
        `,
      [id]
    );

    ctx.body = {
      contract_src: result?.rows[0],
      contracts: contracts?.rows,
    };
    logger.debug('Source loaded in', benchmark.elapsed());
  } catch (e: any) {
    logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}
