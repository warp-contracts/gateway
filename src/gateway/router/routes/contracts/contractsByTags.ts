import Router from '@koa/router';
import { Benchmark } from 'warp-contracts';
import { GatewayError } from '../../../errorHandlerMiddleware';
import { encodeTag } from '../../../../utils';

const MAX_CONTRACTS_PER_PAGE = 100;
const MAX_TAGS_LIST_LENGTH = 5;
const MAX_TAGS_VALUES_LIST_LENGTH = 5;

export async function contractsByTags(ctx: Router.RouterContext) {
  const { logger, dbSource, arweave } = ctx;

  const { tags, owner, page, limit, testnet, srcId } = ctx.query;

  if (!tags) {
    throw new GatewayError('Tag parameter must be provided.', 422);
  }

  logger.debug('Contracts by tag route', { tags, owner, page, limit });

  const parsedPage = page ? parseInt(page as string) : 1;
  const parsedLimit = limit ? Math.min(parseInt(limit as string), MAX_CONTRACTS_PER_PAGE) : MAX_CONTRACTS_PER_PAGE;
  const offset = parsedPage ? (parsedPage - 1) * parsedLimit : 0;

  const bindings: any[] = [];

  const parsedTag = JSON.parse(tags as string);

  if (parsedTag.length > 5) {
    throw new GatewayError(
      `Maximum ${MAX_TAGS_LIST_LENGTH} tags are excepted in the query. Current tags list length: ${parsedTag.length}`,
      422
    );
  }

  if (parsedTag.length < 1) {
    throw new GatewayError(
      `At least one tag in the list is required. Current tags list length: ${parsedTag.length}`,
      422
    );
  }

  let tagsQuery = ``;

  for (let i = 0; i < parsedTag.length; i++) {
    if (parsedTag[i].values.length > 1) {
      if (parsedTag[i].values.length > 5) {
        throw new GatewayError(
          `Tag with name ${parsedTag[i].name} has too many values assigned. Maximum values list length: ${MAX_TAGS_VALUES_LIST_LENGTH}.`,
          422
        );
      }
      let partialTagQuery = ` AND (`;
      partialTagQuery +=
        parsedTag[i].values
          .map(
            (v: string) => `c.contract_tx->'tags' @> '[${JSON.stringify(encodeTag(parsedTag[i].name, v, arweave))}]'`
          )
          .join(' OR ') + ')';
      tagsQuery += partialTagQuery;
    } else {
      const tagEncoded = JSON.stringify(encodeTag(parsedTag[i].name, parsedTag[i].values[0], arweave));
      tagsQuery += ` AND c.contract_tx->'tags' @> '[${tagEncoded}]'`;
    }
  }

  owner && bindings.push(owner);
  srcId && bindings.push(srcId);
  parsedPage && bindings.push(parsedLimit);
  parsedPage && bindings.push(offset);

  const benchmark = Benchmark.measure();
  const result: any = await dbSource.raw(
    `
        SELECT c.contract_id                                                   AS contract,
               c.src_tx_id                                                     AS srcTxId,
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
            ${srcId ? ` AND c.src_tx_id = ?` : ''}
            ${tagsQuery}
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
