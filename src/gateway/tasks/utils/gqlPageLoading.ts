import { ArweaveWrapper, Benchmark, GQLEdgeInterface, GQLResultInterface, GQLTransactionsResultInterface } from "redstone-smartweave";
import { sleep } from "../../../utils";
import {GatewayContext} from "../../init";

const GQL_RETRY_MS = 30 * 1000;

const MAX_GQL_REQUEST = 100;

interface TagFilter {
  name: string;
  values: string[];
}
  
interface BlockFilter {
  min?: number;
  max: number;
}
  
export interface ReqVariables {
  tags: TagFilter[];
  blockFilter: BlockFilter;
  first: number;
  after?: string;
}

export async function loadPages(
  context: GatewayContext,
  variables: ReqVariables,
  query: string
) {
  let contracts = await getNextPage(context, variables, query);
  
  const txInfos: GQLEdgeInterface[] = contracts.edges.filter(
    (c) => !c.node.parent || !c.node.parent.id
  );
  
  while (contracts.pageInfo.hasNextPage) {
    const cursor = contracts.edges[MAX_GQL_REQUEST - 1].cursor;
  
    variables = {
      ...variables,
      after: cursor,
    };
  
    contracts = await getNextPage(context, variables, query);
  
    txInfos.push(
      ...contracts.edges.filter(
        (c) => !c.node.parent || !c.node.parent.id || !c.node.bundledIn || !c.node.bundledIn.id)
    );
  }
  return txInfos;
  }
  
async function getNextPage(
  context: GatewayContext,
  variables: ReqVariables,
  query: string
): Promise<GQLTransactionsResultInterface> {
  const {arweave, logger} = context;
  
  const benchmark = Benchmark.measure();
  const wrapper = new ArweaveWrapper(arweave);
  
  let response = await wrapper.gql(query, variables);
  logger.debug("GQL page load:", benchmark.elapsed());
  
  while (response.status === 403) {
    logger.debug(`GQL rate limiting, waiting ${GQL_RETRY_MS}ms before next try.`);
  
    await sleep(GQL_RETRY_MS);
  
    response =  await wrapper.gql(query, variables);
  }
  
  if (response.status !== 200) {
    throw new Error(`Unable to retrieve contracts. Arweave gateway responded with status ${response.status}.`);
  }
  
  if (response.data.errors) {
    logger.error(response.data.errors);
    throw new Error("Error while loading contracts");
  }
  
  const data: GQLResultInterface = response.data;
  
  return data.data.transactions;
}
  
  