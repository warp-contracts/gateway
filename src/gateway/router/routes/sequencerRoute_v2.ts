import Router from '@koa/router';
import { parseFunctionName } from '../../tasks/syncTransactions';
import { Benchmark, SmartWeaveTags, VrfData, timeout } from 'warp-contracts';
import { isTxIdValid } from '../../../utils';
import { BUNDLR_NODE1_URL } from '../../../constants';
import { Knex } from 'knex';
import { GatewayError } from '../../errorHandlerMiddleware';
import { DataItem } from 'arbundles';
import { createInteraction, generateVrfTags, SequencerResult } from "./sequencerRoute";
import { createSortKey } from './sequencerRoute';
import { tagsExceedLimit } from 'warp-arbundles';
import rawBody from 'raw-body';
import { b64UrlToString } from 'arweave/node/lib/utils';
import { determineOwner } from './deploy/deployContractRoute_v2';

export async function sequencerRoute_v2(ctx: Router.RouterContext) {
  const { dbSource } = ctx;
  const trx = (await dbSource.primaryDb.transaction()) as Knex.Transaction;

  const { timeoutId, timeoutPromise } = timeout(0.5);

  try {
    const result = await Promise.race([timeoutPromise, doGenerateSequence(ctx, trx)]);
    await trx.commit();
    ctx.body = result;
  } catch (e: any) {
    if (trx != null) {
      await trx.rollback();
    }
    throw new GatewayError(e?.message || e);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function doGenerateSequence(ctx: Router.RouterContext, trx: Knex.Transaction): Promise<SequencerResult> {
  const { sLogger, arweave, jwk, vrf, lastTxSync } = ctx;

  const initialBenchmark = Benchmark.measure();

  const benchmark = Benchmark.measure();

  const rawDataItem: Buffer = await rawBody(ctx.req);
  const interactionDataItem = new DataItem(rawDataItem);

  if (tagsExceedLimit(interactionDataItem.tags)) {
    throw new Error(`Interaction data item tags exceed limit.`);
  }

  if (b64UrlToString(interactionDataItem.data).length > 4) {
    throw new Error("Interaction data item's data field exceeds 4 bytes limit.");
  }

  sLogger.debug('New sequencer data item', interactionDataItem.id);

  const isInteractionDataItemValid = await interactionDataItem.isValid();
  if (!isInteractionDataItemValid) {
    ctx.throw(400, 'Interaction data item binary is not valid.');
  }

  const contractTag = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.CONTRACT_TX_ID)!.value;

  const acquireMutexResult = await lastTxSync.acquireMutex(contractTag, trx);
  sLogger.debug('Acquire mutex result', acquireMutexResult);
  // note: lastSortKey can be null if that's a very first interaction with a contract.
  if (
    acquireMutexResult.blockHash == null ||
    acquireMutexResult.blockHeight == null ||
    acquireMutexResult.blockTimestamp == null
  ) {
    throw new Error(`Missing data in acquireMutexResult: ${JSON.stringify(acquireMutexResult)}`);
  }

  const millis = Date.now();
  const sortKey = await createSortKey(
    arweave,
    jwk,
    acquireMutexResult.blockHash,
    millis,
    interactionDataItem.id,
    acquireMutexResult.blockHeight
  );
  if (acquireMutexResult.lastSortKey !== null && sortKey.localeCompare(acquireMutexResult.lastSortKey) <= 0) {
    throw new Error(`New sortKey (${sortKey}) <= lastSortKey (${acquireMutexResult.lastSortKey})!`);
  }

  const originalSignature = interactionDataItem.signature;
  const originalAddress = await determineOwner(interactionDataItem, arweave);
  const testnetVersion = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.WARP_TESTNET)?.value || null;
  const inputTag = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.INPUT)?.value || '';
  const internalWrites: string[] = [];
  interactionDataItem.tags
    .filter((t) => t.name == SmartWeaveTags.INTERACT_WRITE)
    .forEach((t) => internalWrites.push(t.value));

  const tags = [
    { name: 'Sequencer', value: 'RedStone' },
    { name: 'Sequencer-Owner', value: originalAddress },
    { name: 'Sequencer-Tx-Id', value: interactionDataItem.id },
    { name: 'Sequencer-Block-Height', value: '' + acquireMutexResult.blockHeight },
    { name: 'Sequencer-Block-Id', value: acquireMutexResult.blockHash },
    { name: 'Sequencer-Block-Timestamp', value: '' + acquireMutexResult.blockTimestamp },
    { name: 'Sequencer-Mills', value: '' + millis },
    { name: 'Sequencer-Sort-Key', value: sortKey },
    { name: 'Sequencer-Prev-Sort-Key', value: acquireMutexResult.lastSortKey || 'null' },
    ...interactionDataItem.tags,
  ];

  let vrfData: VrfData | null = null;
  const requestVrfTag = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.REQUEST_VRF)?.value || null;
  if (requestVrfTag) {
    const vrfGen = generateVrfTags(sortKey, vrf, arweave);
    tags.push(...vrfGen.vrfTags);
    vrfData = vrfGen.vrfData;
  }

  const interaction = createInteraction(
    interactionDataItem,
    originalAddress,
    interactionDataItem.tags,
    acquireMutexResult.blockHeight,
    acquireMutexResult.blockHash,
    acquireMutexResult.blockTimestamp,
    sortKey,
    vrfData,
    originalSignature,
    testnetVersion,
    acquireMutexResult.lastSortKey
  );

  const parsedInput = JSON.parse(inputTag);
  const functionName = parseFunctionName(inputTag, sLogger);
  let evolve: string | null;
  evolve = functionName == 'evolve' && parsedInput.value && isTxIdValid(parsedInput.value) ? parsedInput.value : null;

  sLogger.debug('Initial benchmark', initialBenchmark.elapsed());
  sLogger.debug('inserting into tables');

  await trx.raw(
    `
        WITH ins_interaction AS (
        INSERT
        INTO interactions (interaction_id,
                           interaction,
                           block_height,
                           block_id,
                           contract_id,
                           function,
                           input,
                           confirmation_status,
                           confirming_peer,
                           source,
                           block_timestamp,
                           interact_write,
                           sort_key,
                           evolve,
                           testnet,
                           last_sort_key,
                           owner,
                           sync_timestamp)
        VALUES (
            :interaction_id,
            :interaction,
            :block_height,
            :block_id,
            :contract_id,
            :function,
            :input,
            :confirmation_status,
            :confirming_peer,
            :source,
            :block_timestamp,
            :interact_write,
            :sort_key,
            :evolve,
            :testnet,
            :prev_sort_key,
            :owner,
            :sync_timestamp)
            RETURNING id)
        INSERT
        INTO bundle_items (interaction_id, state, transaction, tags, data_item)
        SELECT i.id, 'PENDING', :original_transaction, :tags, :data_item
        FROM ins_interaction i;
    `,
    {
      interaction_id: interactionDataItem.id,
      interaction: interaction,
      block_height: acquireMutexResult.blockHeight,
      block_id: acquireMutexResult.blockHash,
      contract_id: contractTag,
      function: functionName,
      input: inputTag,
      confirmation_status: 'confirmed',
      confirming_peer: BUNDLR_NODE1_URL,
      source: 'redstone-sequencer',
      block_timestamp: acquireMutexResult.blockTimestamp,
      interact_write: internalWrites,
      sort_key: sortKey,
      evolve: evolve,
      testnet: testnetVersion,
      prev_sort_key: acquireMutexResult.lastSortKey,
      owner: originalAddress,
      original_transaction: ctx.request.body,
      tags: JSON.stringify(tags),
      sync_timestamp: millis,
      data_item: interactionDataItem.getRaw(),
    }
  );

  sLogger.info('Total sequencer processing', benchmark.elapsed());

  return {
    id: interactionDataItem.id,
    sortKey,
    timestamp: millis,
    prevSortKey: acquireMutexResult.lastSortKey,
    internalWrites
  };
}
