import Router from '@koa/router';
import Transaction from 'arweave/node/lib/transaction';
import { parseFunctionName } from '../../tasks/syncTransactions';
import Arweave from 'arweave';
import { JWKInterface } from 'arweave/node/lib/wallet';
import { arrayToHex, Benchmark, GQLTagInterface, SmartWeaveTags, WarpLogger } from 'warp-contracts';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';
import Bundlr from '@bundlr-network/client';
import { BlockData } from 'arweave/node/blocks';
import { isTxIdValid } from '../../../utils';
import { BUNDLR_NODE1_URL } from '../../../constants';
import { publishInteraction, sendNotification } from '../../publisher';
import { Knex } from 'knex';
import { GatewayError } from '../../errorHandlerMiddleware';
import { VRF } from '../../init';
import { serializeTags } from 'arbundles';
import { DataItem } from 'arbundles';

const { Evaluate } = require('@idena/vrf-js');

export type VrfData = {
  index: string;
  proof: string;
  bigint: string;
  pubkey: string;
};

export async function sequencerRoute(ctx: Router.RouterContext) {
  const { sLogger, arweave, jwk, vrf, lastTxSync, dbSource, signatureVerification } = ctx;

  let trx: Knex.Transaction | null = null;

  try {
    const initialBenchmark = Benchmark.measure();
    const benchmark = Benchmark.measure();

    const transaction: Transaction = new Transaction({ ...ctx.request.body });
    sLogger.debug('New sequencer tx', transaction.id);

    const originalSignature = transaction.signature;
    const originalOwner = transaction.owner;
    let {
      contractTag,
      inputTag,
      requestVrfTag,
      internalWrites,
      decodedTags,
      originalAddress,
      isEvmSigner,
      testnetVersion,
    } = await prepareTags(sLogger, transaction, originalOwner, arweave);

    trx = (await dbSource.primaryDb.transaction()) as Knex.Transaction;
    const contractPrevSortKey: string | null = await lastTxSync.acquireMutex(contractTag, trx);
    const millis = Date.now();
    const { currentHeight, currentBlockTimestamp, currentBlockId, cachedBlockInfo } = await getBlockInfo(
      transaction.id,
      sLogger
    );
    const sortKey = await createSortKey(arweave, jwk, currentBlockId, millis, transaction.id, currentHeight);
    if (contractPrevSortKey !== null && sortKey.localeCompare(contractPrevSortKey) <= 0) {
      throw new Error(`New sortKey (${sortKey}) <= lastSortKey (${contractPrevSortKey})!`);
    }

    const tags = getUploaderTags(
      originalAddress,
      transaction.id,
      currentHeight,
      currentBlockId,
      currentBlockTimestamp,
      decodedTags
    );

    tags.push({ name: 'Sequencer-Mills', value: '' + millis });
    tags.push({ name: 'Sequencer-Sort-Key', value: sortKey });
    tags.push({ name: 'Sequencer-Prev-Sort-Key', value: contractPrevSortKey || 'null' });

    let vrfData = null;
    if (requestVrfTag !== '') {
      const vrfGen = generateVrfTags(sortKey, vrf, arweave);
      tags.push(...vrfGen.vrfTags);
      vrfData = vrfGen.vrfData;
    }

    const interaction = createInteraction(
      transaction,
      originalAddress,
      decodedTags,
      currentHeight,
      currentBlockId,
      cachedBlockInfo,
      sortKey,
      vrfData,
      isEvmSigner ? originalSignature : null,
      testnetVersion,
      contractPrevSortKey
    );

    const verified = isEvmSigner
      ? await signatureVerification.process(interaction)
      : await arweave.transactions.verify(transaction);
    if (!verified) {
      throw new Error('Could not properly verify transaction.');
    }

    const parsedInput = JSON.parse(inputTag);
    const functionName = parseFunctionName(inputTag, sLogger);
    let evolve: string | null;
    evolve = functionName == 'evolve' && parsedInput.value && isTxIdValid(parsedInput.value) ? parsedInput.value : null;

    sLogger.debug('Initial benchmark', initialBenchmark.elapsed());
    sLogger.debug('inserting into tables');

    try {
      serializeTags(tags);
    } catch (e) {
      throw new Error(`Tags could not be serialized properly. It may be due to the big input size.`);
    }

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
        INTO bundle_items (interaction_id, state, transaction, tags)
        SELECT i.id, 'PENDING', :original_transaction, :tags
        FROM ins_interaction i;
    `,
      {
        interaction_id: transaction.id,
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
        owner: originalOwner,
        original_transaction: ctx.request.body,
        tags: JSON.stringify(tags),
        sync_timestamp: millis,
      }
    );

    await trx.commit();
    sLogger.info('Total sequencer processing', benchmark.elapsed());

    ctx.body = {
      id: transaction.id,
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
      await trx.rollback();
    }
    throw new GatewayError(e?.message || e);
  }
}

export function createInteraction(
  transactionOrDataItem: Transaction | DataItem,
  originalAddress: string,
  decodedTags: GQLTagInterface[],
  currentHeight: number,
  currentBlockId: string,
  blockInfo: BlockData,
  sortKey: string,
  vrfData: VrfData | null,
  signature: string | null,
  testnetVersion: string | null,
  lastSortKey: string | null
) {
  const interaction: any = {
    id: transactionOrDataItem.id,
    owner: { address: originalAddress },
    recipient: transactionOrDataItem.target,
    tags: decodedTags,
    block: {
      height: currentHeight,
      id: currentBlockId,
      timestamp: blockInfo.timestamp,
    },
    fee: {
      winston: isTransaction(transactionOrDataItem) ? transactionOrDataItem.reward : '0',
    },
    quantity: {
      winston: isTransaction(transactionOrDataItem) ? transactionOrDataItem.quantity : '',
    },
    sortKey: sortKey,
    source: 'redstone-sequencer',
    vrf: vrfData,
    testnet: testnetVersion,
    lastSortKey,
  };

  if (signature) {
    interaction.signature = signature;
  }

  return interaction;
}

function isTransaction(transactionOrDataItem: Transaction | DataItem): transactionOrDataItem is Transaction {
  return (transactionOrDataItem as Transaction).last_tx != undefined;
}

export function generateVrfTags(sortKey: string, vrf: VRF, arweave: Arweave) {
  const privateKey = vrf.privKey.toArray();
  const data = arweave.utils.stringToBuffer(sortKey);
  const [index, proof] = Evaluate(privateKey, data);

  const vrfData: VrfData = {
    index: arweave.utils.bufferTob64Url(index),
    proof: arweave.utils.bufferTob64Url(proof),
    bigint: bufToBn(index).toString(),
    pubkey: vrf.pubKeyHex,
  };

  return {
    vrfTags: [
      { name: 'vrf-index', value: vrfData.index },
      { name: 'vrf-proof', value: vrfData.proof },
      { name: 'vrf-bigint', value: vrfData.bigint },
      { name: 'vrf-pubkey', value: vrfData.pubkey },
    ],
    vrfData,
  };
}

function bufToBn(buf: Array<number>) {
  const hex: string[] = [];
  const u8 = Uint8Array.from(buf);

  u8.forEach(function (i) {
    let h = i.toString(16);
    if (h.length % 2) {
      h = '0' + h;
    }
    hex.push(h);
  });

  return BigInt('0x' + hex.join(''));
}

async function prepareTags(logger: any, transaction: Transaction, originalOwner: string, arweave: Arweave) {
  let contractTag: string = '',
    inputTag: string = '',
    requestVrfTag = '',
    originalAddress = '',
    isEvmSigner = false,
    testnetVersion = null;

  const decodedTags: GQLTagInterface[] = [];

  const internalWrites: string[] = [];

  for (const tag of transaction.tags) {
    const key = tag.get('name', { decode: true, string: true });
    const value = tag.get('value', { decode: true, string: true });
    if (key == SmartWeaveTags.CONTRACT_TX_ID) {
      contractTag = value;
    }
    if (key == SmartWeaveTags.INPUT) {
      inputTag = value;
    }
    if (key == SmartWeaveTags.INTERACT_WRITE) {
      internalWrites.push(value);
    }
    if (key == SmartWeaveTags.REQUEST_VRF) {
      requestVrfTag = value;
    }
    if (key == 'Signature-Type' && value == 'ethereum') {
      logger.info(`Signature type for ${transaction.id}`, value);
      originalAddress = originalOwner;
      logger.info(`original address type for ${transaction.id}`, originalOwner);
      isEvmSigner = true;
    }
    if (key == 'Warp-Testnet') {
      testnetVersion = value;
    }
    decodedTags.push({
      name: key,
      value: value,
    });
  }

  if (!isEvmSigner) {
    originalAddress = await arweave.wallets.ownerToAddress(originalOwner);
  }

  return {
    contractTag,
    inputTag,
    requestVrfTag,
    internalWrites,
    decodedTags,
    originalAddress,
    isEvmSigner,
    testnetVersion,
  };
}

export function getUploaderTags(
  originalAddress: string,
  id: string,
  currentHeight: number,
  currentBlockId: string,
  currentBlockTimestamp: number,
  decodedTags: GQLTagInterface[]
): GQLTagInterface[] {
  return [
    { name: 'Sequencer', value: 'RedStone' },
    { name: 'Sequencer-Owner', value: originalAddress },
    { name: 'Sequencer-Tx-Id', value: id },
    { name: 'Sequencer-Block-Height', value: '' + currentHeight },
    { name: 'Sequencer-Block-Id', value: currentBlockId },
    { name: 'Sequencer-Block-Timestamp', value: '' + currentBlockTimestamp },
    ...decodedTags,
  ];
}

export async function uploadToBundlr(
  transaction: Transaction,
  bundlr: Bundlr,
  tags: GQLTagInterface[],
  logger: WarpLogger
) {
  const uploadBenchmark = Benchmark.measure();

  const bTx = bundlr.createTransaction(JSON.stringify(transaction), { tags });
  await bTx.sign();
  const bundlrResponse = await bundlr.uploader.uploadTransaction(bTx, { getReceiptSignature: true });

  logger.debug('Uploading to bundlr', {
    elapsed: uploadBenchmark.elapsed(),
    id: bundlrResponse.data.id,
    status: bundlrResponse.status,
  });

  if (bundlrResponse.status !== 200 || !bundlrResponse.data.signature) {
    throw new Error(
      `Bundlr did not upload transaction ${bTx?.id} correctly. Bundlr responded with status ${bundlrResponse.status}.`
    );
  }

  return { bTx, bundlrResponse };
}

export async function createSortKey(
  arweave: Arweave,
  jwk: JWKInterface,
  blockId: string,
  mills: number,
  transactionId: string,
  blockHeight: number
) {
  const blockHashBytes = arweave.utils.b64UrlToBuffer(blockId);
  const txIdBytes = arweave.utils.b64UrlToBuffer(transactionId);
  const jwkDBytes = arweave.utils.b64UrlToBuffer(jwk.d as string);
  const concatenated = arweave.utils.concatBuffers([blockHashBytes, txIdBytes, jwkDBytes]);
  const hashed = arrayToHex(await arweave.crypto.hash(concatenated));

  const blockHeightString = `${blockHeight}`.padStart(12, '0');

  return `${blockHeightString},${mills},${hashed}`;
}

export async function getBlockInfo(id: string, sLogger: any) {
  const BLOCK_HEIGHT_X = 1235834;// FIXME: temp, for sync migration
  const cachedNetworkData = getCachedNetworkData();
  if (cachedNetworkData == null) {
    throw new Error('Network or block info not yet cached.');
  }
  let currentHeight = cachedNetworkData.cachedBlockInfo.height;
  let currentBlockTimestamp = cachedNetworkData.cachedBlockInfo.timestamp;
  let currentBlockId = cachedNetworkData.cachedNetworkInfo.current;
  if (currentHeight > BLOCK_HEIGHT_X) {
    currentHeight = BLOCK_HEIGHT_X;
    const response = await fetch(`https://arweave.net/block/height/${BLOCK_HEIGHT_X}`);
    if (!response.ok) {
      sLogger.error(`Block ${id}, fetching ${BLOCK_HEIGHT_X} failed with status ${response.status}}`);
      throw new Error(`Cannot fetch block data ${response.status}`);
    }
    const block = await response.json();

    currentBlockId = block.indep_hash;
    currentBlockTimestamp = block.timestamp;
  }
  sLogger.debug(`Sequencer height: ${id}: ${currentHeight}`);
  if (!currentHeight) {
    throw new Error('Current height not set');
  }
  if (!currentBlockTimestamp) {
    throw new Error('Current block timestamp not set');
  }
  if (!currentBlockId) {
    throw new Error('Current block not set');
  }

  return {currentHeight, currentBlockTimestamp, currentBlockId, cachedBlockInfo: cachedNetworkData.cachedBlockInfo};
}
