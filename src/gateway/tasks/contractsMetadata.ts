import {TaskRunner} from "./TaskRunner";
import {GatewayContext} from "../init";
import {ContractDefinitionLoader, GQLEdgeInterface, SmartWeaveTags} from "redstone-smartweave";
import {loadPages, MAX_GQL_REQUEST, ReqVariables} from "../../gql";
import {AVG_BLOCKS_PER_HOUR, FIRST_SW_TX_BLOCK_HEIGHT, MAX_BATCH_INSERT} from "./syncTransactions";
import {Knex} from "knex";

const CONTRACTS_METADATA_INTERVAL_MS = 2000;

const CONTRACTS_QUERY = `query Transactions($tags: [TagFilter!]!, $blockFilter: BlockFilter!, $first: Int!, $after: String) {
    transactions(tags: $tags, block: $blockFilter, first: $first, sort: HEIGHT_ASC, after: $after) {
      pageInfo {
        hasNextPage
      }
      edges {
        node {
          id
          tags {
            name
            value
          }
          block {
            height
          }
        }
        cursor
      }
    }
  }`;

export async function runContractsMetadataTask(context: GatewayContext) {
  await TaskRunner
    .from("[contracts metadata]", loadContractsMetadata, context)
    .runSyncEvery(CONTRACTS_METADATA_INTERVAL_MS);
}


export async function runLoadContractsFromGqlTask(context: GatewayContext) {
  await TaskRunner
    .from("[contracts from gql]", loadContractsFromGql, context)
    .runSyncEvery(CONTRACTS_METADATA_INTERVAL_MS);
}


async function loadContractsFromGql(context: GatewayContext) {
  const {logger, gatewayDb, arweaveWrapper} = context;

  let results: any[];
  try {
    results = await Promise.allSettled([
      gatewayDb("contracts")
        .select("block_height")
        .whereNotNull("block_height")
        .orderBy("block_height", "desc")
        .limit(1)
        .first(),
      arweaveWrapper.info()
    ]);
  } catch (e: any) {
    logger.error("Error while checking new blocks", e.message);
    return;
  }

  const rejections = results.filter((r) => {
    return r.status === "rejected";
  });

  if (rejections.length > 0) {
    logger.error("Error while processing next block", rejections.map((r) => r.message));
    return;
  }

  const currentNetworkHeight = results[1].value.height;
  const lastProcessedBlockHeight = results[0].value?.block_height || 0;

  logger.debug("Load contracts params", {
    from: lastProcessedBlockHeight - AVG_BLOCKS_PER_HOUR,
    to: currentNetworkHeight
  });

  let transactions: GQLEdgeInterface[]
  try {
    transactions = await load(
      context,
      lastProcessedBlockHeight - AVG_BLOCKS_PER_HOUR,
      currentNetworkHeight
    );
  } catch (e: any) {
    logger.error("Error while loading contracts", e.message);
    return;
  }

  if (transactions.length === 0) {
    logger.info("Now new contracts");
    return;
  }

  logger.info(`Found ${transactions.length} contracts`);

  let contractsInserts: any[] = [];

  const contractsInsertsIds = new Set<string>();
  for (let transaction of transactions) {
    const contractId = transaction.node.id;
    if (!contractsInsertsIds.has(contractId)) {
      const contentType = getContentTypeTag(transaction);
      if (!contentType) {
        logger.warn(`Cannot determine contract content type for contract ${contractId}`);
      }
      contractsInserts.push({
        contract_id: transaction.node.id,
        block_height: transaction.node.block.height,
        content_type: contentType || "unknown"
      });
      contractsInsertsIds.add(contractId);

      if (contractsInserts.length === MAX_BATCH_INSERT) {
        try {
          logger.info(`Batch insert ${MAX_BATCH_INSERT} interactions.`);
          await insertContracts(gatewayDb, contractsInserts);
          contractsInserts = [];
        } catch (e) {
          logger.error(e);
          return;
        }
      }
    }
  }

  logger.info(`Saving last`, contractsInserts.length);

  if (contractsInserts.length > 0) {
    try {
      await insertContracts(gatewayDb, contractsInserts);
    } catch (e) {
      logger.error(e);
      return;
    }
  }

  logger.info(`Inserted ${contractsInserts.length} contracts`);
}


async function insertContracts(gatewayDb: Knex<any, unknown[]>, contractsInserts: any[]) {
  await gatewayDb("contracts")
    .insert(contractsInserts)
    .onConflict("contract_id")
    .merge(['block_height', 'content_type']);
}


function getContentTypeTag(interactionTransaction: GQLEdgeInterface): string | undefined {
  return interactionTransaction.node.tags.find((tag) => tag.name === SmartWeaveTags.CONTENT_TYPE)?.value;
}


async function load(
  context: GatewayContext,
  from: number,
  to: number
): Promise<GQLEdgeInterface[]> {
  const variables: ReqVariables = {
    tags: [
      {
        name: SmartWeaveTags.APP_NAME,
        values: ["SmartWeaveContract"],
      }
    ],
    blockFilter: {
      min: from,
      max: to,
    },
    first: MAX_GQL_REQUEST,
  };

  return await loadPages(context, CONTRACTS_QUERY, variables);
}

async function loadContractsMetadata(context: GatewayContext) {
  const {arweave, logger, gatewayDb} = context;
  const definitionLoader = new ContractDefinitionLoader(arweave);

  const result: { contract: string }[] = (await gatewayDb.raw(
    `
        SELECT contract_id AS contract
        FROM contracts
        WHERE contract_id != ''
          AND contract_id NOT ILIKE '()%'
          AND src_tx_id IS NULL
        AND type IS NULL;
    `
  )).rows;

  const missing = result?.length || 0;
  logger.info(`Loading ${missing} contract definitions.`);

  if (missing == 0) {
    return;
  }

  for (const row of result) {
    logger.debug(`Loading ${row.contract} definition.`);
    try {
      const definition: any = await definitionLoader.load(row.contract.trim());
      const type = evalType(definition.initState);

      let update: any = {
        src_tx_id: definition.srcTxId,
        init_state: definition.initState,
        owner: definition.owner,
        type: evalType(definition.initState),
        pst_ticker: type == 'pst' ? definition.initState?.ticker : null,
        pst_name: type == 'pst' ? definition.initState?.name : null,
        src_content_type: definition.contractType == 'js'
          ? 'application/javascript'
          : 'application/wasm'
      };

      if (definition.contractType == 'js') {
        update = {
          ...update,
          src: definition.src
        }
      } else {
        update = {
          ...update,
          src_binary: definition.srcBinary,
          src_wasm_lang: definition.srcWasmLang
        }
      }

      await gatewayDb("contracts")
        .where('contract_id', '=', definition.txId)
        .update(update);
    } catch (e) {
      logger.error("Error while loading contract definition", e);
      await gatewayDb("contracts")
        .where('contract_id', '=', row.contract.trim())
        .update({
          type: "error"
        });
    }
  }

}

function evalType(initState: any): string {
  if (initState.ticker && initState.balances) {
    return "pst";
  }

  return "other";
}

