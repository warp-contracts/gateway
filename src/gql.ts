import { GatewayContext } from './gateway/init';
import { Benchmark, GQLEdgeInterface, GQLResultInterface, GQLTransactionsResultInterface } from 'redstone-smartweave';
import { sleep } from './utils';

export const MAX_GQL_REQUEST = 100;
const GQL_RETRY_MS = 30 * 1000;

export interface TagFilter {
  name: string;
  values: string[];
}

export interface BlockFilter {
  min?: number;
  max: number;
}

export interface ReqVariables {
  tags: TagFilter[];
  blockFilter: BlockFilter;
  first: number;
  after?: string;
}

function filterBundles(tx: GQLEdgeInterface) {
  return !tx.node.parent?.id && !tx.node.bundledIn?.id;
}

export async function loadPages(context: GatewayContext, query: string, variables: ReqVariables) {
  let transactions = await getNextPage(context, query, variables);

  const txInfos: GQLEdgeInterface[] = transactions.edges.filter((tx) => filterBundles(tx));

  while (transactions.pageInfo.hasNextPage) {
    const cursor = transactions.edges[MAX_GQL_REQUEST - 1].cursor;

    variables = {
      ...variables,
      after: cursor,
    };

    transactions = await getNextPage(context, query, variables);

    txInfos.push(...transactions.edges.filter((tx) => filterBundles(tx)));
  }
  return txInfos;
}

export async function getNextPage(
  context: GatewayContext,
  query: string,
  variables: ReqVariables
): Promise<GQLTransactionsResultInterface> {
  const { logger, arweaveWrapper } = context;

  const benchmark = Benchmark.measure();
  let response = await arweaveWrapper.gql(query, variables);
  logger.debug('GQL page load:', benchmark.elapsed());

  while (response.status === 403) {
    logger.warn(`GQL rate limiting, waiting ${GQL_RETRY_MS}ms before next try.`);

    await sleep(GQL_RETRY_MS);

    response = await arweaveWrapper.gql(query, variables);
  }

  if (response.status !== 200) {
    throw new Error(`Unable to retrieve transactions. Arweave gateway responded with status ${response.status}.`);
  }

  if (response.data.errors) {
    logger.error(response.data.errors);
    throw new Error('Error while loading interaction transactions');
  }

  const data: GQLResultInterface = response.data;

  return data.data.transactions;
}
