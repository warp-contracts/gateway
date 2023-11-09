import Router from '@koa/router';
import { Benchmark } from 'warp-contracts';
import { GatewayError } from '../../../errorHandlerMiddleware';

const MAX_CONTRACTS_PER_PAGE = 100;

export async function contractsByTag(ctx: Router.RouterContext) {
  const { logger, dbSource, arweave } = ctx;

  const { tag, owner, page, limit, testnet } = ctx.query;

  if (!tag) {
    throw new GatewayError('Tag parameter must be provided.', 422);
  }

  logger.debug('Contracts by tag route', { tag, owner, page, limit });

  const parsedPage = page ? parseInt(page as string) : 1;
  const parsedLimit = limit ? Math.min(parseInt(limit as string), MAX_CONTRACTS_PER_PAGE) : MAX_CONTRACTS_PER_PAGE;
  const offset = parsedPage ? (parsedPage - 1) * parsedLimit : 0;

  const bindings: any[] = [];
  const tagEncoded = JSON.stringify({
    name: arweave.utils.stringToB64Url(JSON.parse(tag as string).name),
    value: arweave.utils.stringToB64Url(JSON.parse(tag as string).value),
  });

  owner && bindings.push(owner);
  parsedPage && bindings.push(parsedLimit);
  parsedPage && bindings.push(offset);

  const benchmark = Benchmark.measure();
  const result: any = await dbSource.raw(
    `
        SELECT c.contract_id                                                   AS contract,
               c.owner                                                         AS owner,
               c.testnet                                                       AS testnet,
               c.contract_tx                                                   AS contractTx,
               c.sync_timestamp                                                AS syncTimestamp,
               count(*) OVER ()                                                AS total
        FROM contracts c
        WHERE c.contract_id != ''
          AND c.type != 'error'
            ${testnet ? ' AND c.testnet IS NOT NULL' : ''}
            ${owner ? ` AND c.owner = ?` : ''}
            AND c.contract_tx->'tags' @> '[${tagEncoded}]'
        GROUP BY c.contract_id, c.owner
        ORDER BY c.sync_timestamp DESC
        ${parsedPage ? ' LIMIT ? OFFSET ?' : ''};
    `,
    bindings
  );

  const total = result?.rows?.length > 0 ? parseInt(result.rows[0].total) : 0;
  ctx.body = {
    paging: {
      total,
      limit: parsedLimit,
      items: result?.rows.length,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit),
    },
    contracts: result?.rows.map((r: any) => {
      return {
        ...r,
        contracttx: {
          tags: r.contracttx.tags.map((t: any) => {
            try {
              const name = arweave.utils.b64UrlToString(t.name);
              const value = arweave.utils.b64UrlToString(t.value);
              return { name, value };
            } catch (e) {
              return;
            }
          }),
        },
      };
    }),
  };
  logger.debug('Contracts loaded in', benchmark.elapsed());
}
