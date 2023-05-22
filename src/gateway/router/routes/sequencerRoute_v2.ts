import Router from '@koa/router';
import { parseFunctionName, safeParseInput } from '../../tasks/syncTransactions';
import { Benchmark, SmartWeaveTags, VrfData } from 'warp-contracts';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';
import { isTxIdValid } from '../../../utils';
import { BUNDLR_NODE1_URL } from '../../../constants';
import { publishInteraction, sendNotification } from '../../publisher';
import { Knex } from 'knex';
import { GatewayError } from '../../errorHandlerMiddleware';
import { DataItem } from 'arbundles';
import { createInteraction, generateVrfTags, getUploaderTags } from './sequencerRoute';
import { createSortKey } from './sequencerRoute';
import { tagsExceedLimit } from 'warp-arbundles';
import rawBody from 'raw-body';
import { b64UrlToString } from 'arweave/node/lib/utils';
import { determineOwner } from './deploy/deployContractRoute_v2';

export async function sequencerRoute_v2(ctx: Router.RouterContext) {
  const { sLogger, arweave, jwk, vrf, lastTxSync, dbSource, bundlr } = ctx;

  let trx: Knex.Transaction | null = null;

  try {
    const initialBenchmark = Benchmark.measure();
    const cachedNetworkData = getCachedNetworkData();
    if (cachedNetworkData == null) {
      throw new Error('Network or block info not yet cached.');
    }
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

    const currentHeight = cachedNetworkData.cachedBlockInfo.height;
    sLogger.debug(`Sequencer height: ${interactionDataItem.id}: ${currentHeight}`);

    if (!currentHeight) {
      throw new Error('Current height not set');
    }

    const currentBlockTimestamp = cachedNetworkData.cachedBlockInfo.timestamp;
    if (!currentBlockTimestamp) {
      throw new Error('Current block timestamp not set');
    }

    const currentBlockId = cachedNetworkData.cachedNetworkInfo.current;
    if (!currentBlockId) {
      throw new Error('Current block not set');
    }

    const originalSignature = interactionDataItem.signature;
    const contractTag = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.CONTRACT_TX_ID)!.value;
    const originalAddress = await determineOwner(interactionDataItem, arweave);
    const testnetVersion = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.WARP_TESTNET)?.value || null;
    const internalWrites: string[] = [];
    interactionDataItem.tags
      .filter((t) => t.name == SmartWeaveTags.INTERACT_WRITE)
      .forEach((t) => internalWrites.push(t.value));
    const trx = await dbSource.primaryDb.transaction();
    const contractPrevSortKey: string | null = await lastTxSync.acquireMutex(contractTag, trx);
    const millis = Date.now();
    const sortKey = await createSortKey(arweave, jwk, currentBlockId, millis, interactionDataItem.id, currentHeight);
    if (contractPrevSortKey !== null && sortKey.localeCompare(contractPrevSortKey) <= 0) {
      throw new Error(`New sortKey (${sortKey}) <= lastSortKey (${contractPrevSortKey})!`);
    }

    const tags = getUploaderTags(
      originalAddress,
      interactionDataItem.id,
      currentHeight,
      currentBlockId,
      currentBlockTimestamp,
      interactionDataItem.tags
    );
    tags.push({ name: 'Sequencer-Mills', value: '' + millis });
    tags.push({ name: 'Sequencer-Sort-Key', value: sortKey });
    tags.push({ name: 'Sequencer-Prev-Sort-Key', value: contractPrevSortKey || 'null' });

    let vrfData: VrfData | null = null;
    const requestVrfTag = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.REQUEST_VRF)?.value || null;
    if (requestVrfTag) {
      const vrfGen = generateVrfTags(sortKey, vrf, arweave);
      tags.push(...vrfGen.vrfTags);
      vrfData = vrfGen.vrfData;
    }

    const inputTag = interactionDataItem.tags.find((t) => t.name == SmartWeaveTags.INPUT)?.value || '';

    const parsedInput = safeParseInput(inputTag, sLogger);
    const functionName = parseFunctionName(inputTag, sLogger);
    let evolve: string | null;
    evolve = functionName == 'evolve' && parsedInput.value && isTxIdValid(parsedInput.value) ? parsedInput.value : null;

    sLogger.debug('Initial benchmark', initialBenchmark.elapsed());

    const interaction = createInteraction(
      interactionDataItem,
      originalAddress,
      interactionDataItem.tags,
      currentHeight,
      currentBlockId,
      cachedNetworkData.cachedBlockInfo,
      sortKey,
      vrfData,
      originalSignature,
      testnetVersion,
      parsedInput
    );

    sLogger.debug('inserting into tables');

    await trx.raw(
      `
        WITH ins_interaction AS (
            INSERT INTO interactions (interaction_id,
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
                VALUES (:interaction_id,
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
        block_height: currentHeight,
        block_id: currentBlockId,
        contract_id: contractTag,
        function: functionName,
        input: inputTag,
        confirmation_status: 'confirmed',
        confirming_peer: BUNDLR_NODE1_URL,
        source: 'redstone-sequencer',
        block_timestamp: currentBlockTimestamp,
        interact_write: internalWrites,
        sort_key: sortKey,
        evolve: evolve,
        testnet: testnetVersion,
        prev_sort_key: contractPrevSortKey,
        owner: originalAddress,
        original_transaction: ctx.request.body,
        tags: JSON.stringify(tags),
        sync_timestamp: millis,
        data_item: interactionDataItem.getRaw(),
      }
    );

    await trx.commit();
    sLogger.info('Total sequencer processing', benchmark.elapsed());

    ctx.body = {
      id: interactionDataItem.id,
    };

    sendNotification(ctx, contractTag, undefined, interaction);
    publishInteraction(
      ctx,
      contractTag,
      interaction,
      sortKey,
      contractPrevSortKey,
      functionName,
      'redstone-sequencer',
      millis,
      testnetVersion
    );
  } catch (e: any) {
    if (trx != null) {
      await (trx as Knex.Transaction).rollback();
    }
    throw new GatewayError(e?.message || e);
  }
}
