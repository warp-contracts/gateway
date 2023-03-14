import Router from '@koa/router';
import { Benchmark } from 'warp-contracts';
import { isTxIdValid } from '../../../utils';

const MAX_INTERACTIONS_PER_PAGE = 5000;

export async function contractsBySourceRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb } = ctx;

  const { id, page, limit, sort } = ctx.query;

  const parsedPage = page ? parseInt(page as string) : 1;

  const parsedLimit = limit
    ? Math.min(parseInt(limit as string), MAX_INTERACTIONS_PER_PAGE)
    : MAX_INTERACTIONS_PER_PAGE;
  const offset = parsedPage ? (parsedPage - 1) * parsedLimit : 0;

  if (!isTxIdValid(id as string)) {
    logger.error('Incorrect contract source transaction id.');
    ctx.status = 500;
    ctx.body = { message: 'Incorrect contract source transaction id.' };
    return;
  }

  const bindings: any = [];
  id && bindings.push(id);
  parsedPage && bindings.push(parsedLimit);
  parsedPage && bindings.push(offset);

  try {
    const benchmark = Benchmark.measure();

    const result: any = await gatewayDb.raw(
      `
            SELECT  c.contract_id                                                                       as "contractId",
                    c.owner                                                                             as "owner",
                    c.bundler_contract_tx_id                                                            as "bundlerTxId",
                    c.block_height                                                                      as "blockHeight",
                    c.block_timestamp                                                                   as "blockTimestamp",
                    count(i.contract_id)                                                                as "interactions",
                    count(*) OVER () AS total
            FROM contracts c
            LEFT JOIN interactions i
            ON c.contract_id = i.contract_id
            WHERE src_tx_id = ?
            AND c.type != 'error'
            GROUP BY c.contract_id
            ${sort == 'desc' || sort == 'asc' ? `ORDER BY c.block_height ${sort.toUpperCase()}` : ''}
            LIMIT ? OFFSET ?; 
        `,
      bindings
    );

    console.log(result.rows.length);
    const total = result?.rows?.length > 0 ? result?.rows[0].total : 0;

    ctx.body = {
      paging: {
        total,
        limit: parsedLimit,
        items: result?.rows.length,
        page: parsedPage,
        pages: Math.ceil(total / parsedLimit),
      },
      contracts: result?.rows,
    };
    logger.debug('Source loaded in', benchmark.elapsed());
  } catch (e: any) {
    logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}
