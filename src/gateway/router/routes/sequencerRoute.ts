import Router from "@koa/router";
import Transaction from "arweave/node/lib/transaction";
import {parseFunctionName} from "../../tasks/syncTransactions";
import Arweave from "arweave";
import {JWKInterface} from "arweave/node/lib/wallet";
import {arrayToHex, Benchmark, GQLTagInterface, RedStoneLogger, SmartWeaveTags} from "redstone-smartweave";
import {getCachedNetworkData} from "../../tasks/networkInfoCache";
import util from "util";
import {gzip} from "zlib";
import Bundlr from "@bundlr-network/client";
import {BlockData} from "arweave/node/blocks";

export async function sequencerRoute(ctx: Router.RouterContext) {
  const {sLogger, gatewayDb, arweave, bundlr, jwk} = ctx;

  const cachedNetworkData = getCachedNetworkData();

  const benchmark = Benchmark.measure();

  const transaction: Transaction = new Transaction({...ctx.request.body});
  sLogger.debug("New sequencer tx", transaction.id);

  const originalSignature = transaction.signature;
  const originalOwner = transaction.owner;
  const originalAddress = await arweave.wallets.ownerToAddress(originalOwner);

  try {
    if (cachedNetworkData == null) {
      throw new Error("Network or block info not yet cached.");
    }

    const currentHeight = cachedNetworkData.cachedNetworkInfo.height;
    sLogger.debug(`Sequencer height: ${transaction.id}: ${currentHeight}`);

    if (!currentHeight) {
      throw new Error("Current height not set");
    }

    const currentBlockId = cachedNetworkData.cachedNetworkInfo.current;
    if (!currentBlockId) {
      throw new Error("Current block not set");
    }

    const millis = Date.now();
    const sortKey = await createSortKey(arweave, jwk, currentBlockId, millis, transaction.id, currentHeight);

    let {
      contractTag,
      inputTag,
      internalWrites,
      decodedTags,
      tags
    } = prepareTags(transaction, originalAddress, millis, sortKey, currentHeight, currentBlockId);

    // TODO: add fallback to other bundlr nodes.
    const {bTx, bundlrResponse} = await uploadToBundlr(transaction, bundlr, tags, sLogger);

    const interaction = createInteraction(
      transaction,
      originalAddress,
      decodedTags,
      currentHeight,
      currentBlockId,
      cachedNetworkData.cachedBlockInfo,
      sortKey);

    const insertBench = Benchmark.measure();

    await Promise.allSettled([
      gatewayDb("sequencer")
        .insert({
          original_sig: originalSignature,
          original_owner: originalOwner,
          original_address: originalAddress,
          sequence_block_id: currentBlockId,
          sequence_block_height: currentHeight,
          sequence_transaction_id: transaction.id,
          sequence_millis: "" + millis,
          sequence_sort_key: sortKey,
          bundler_tx_id: bTx.id,
          bundler_response: JSON.stringify(bundlrResponse.data)
        }),
      gatewayDb("interactions")
        .insert({
          interaction_id: transaction.id,
          interaction: JSON.stringify(interaction),
          block_height: currentHeight,
          block_id: currentBlockId,
          contract_id: contractTag,
          function: parseFunctionName(inputTag, sLogger),
          input: inputTag,
          confirmation_status: "confirmed",
          confirming_peer: "https://node1.bundlr.network",
          source: "redstone-sequencer",
          bundler_tx_id: bTx.id,
          interact_write: internalWrites
        })
    ]);

    sLogger.debug("Inserting into tables", insertBench.elapsed());
    sLogger.debug("Transaction successfully bundled", {
      id: transaction.id,
      bundled_tx_id: bTx.id
    });

    ctx.body = bundlrResponse.data;
    sLogger.info("Total sequencer processing", benchmark.elapsed());
  } catch (e) {
    sLogger.error("Error while inserting bundled transaction");
    sLogger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}

function createInteraction(
  transaction: Transaction,
  originalAddress: string,
  decodedTags: GQLTagInterface[],
  currentHeight: number,
  currentBlockId: string,
  blockInfo: BlockData,
  sortKey: string) {

  const interaction: any = {
    id: transaction.id,
    owner: {address: originalAddress},
    recipient: transaction.target,
    tags: decodedTags,
    block: {
      height: currentHeight,
      id: currentBlockId,
      timestamp: blockInfo.timestamp
    },
    fee: {
      winston: transaction.reward
    },
    quantity: {
      winston: transaction.quantity
    },
    sortKey: sortKey,
    source: "redstone-sequencer"
  }

  return interaction;
}


function prepareTags(
  transaction: Transaction,
  originalAddress: string,
  millis: number,
  sortKey: string,
  currentHeight: number,
  currentBlockId: string) {

  let contractTag: string = '', inputTag: string = '';

  const decodedTags: GQLTagInterface[] = [];

  const internalWrites: string[] = [];

  transaction.tags.forEach(tag => {
    const key = tag.get('name', {decode: true, string: true});
    const value = tag.get('value', {decode: true, string: true});
    if (key == SmartWeaveTags.CONTRACT_TX_ID) {
      contractTag = value;
    }
    if (key == SmartWeaveTags.INPUT) {
      inputTag = value;
    }
    if (key == SmartWeaveTags.INTERACT_WRITE) {
      internalWrites.push(value);
    }
    decodedTags.push({
      name: key,
      value: value
    });
  });

  const tags = [
    {name: "Sequencer", value: "RedStone"},
    {name: "Sequencer-Owner", value: originalAddress},
    {name: "Sequencer-Mills", value: "" + millis},
    {name: "Sequencer-Sort-Key", value: sortKey},
    {name: "Sequencer-Tx-Id", value: transaction.id},
    {name: "Sequencer-Block-Height", value: "" + currentHeight},
    {name: "Sequencer-Block-Id", value: currentBlockId},
    {name: "Sequencer-Compression", value: "gzip"},
    ...decodedTags
  ];

  return {contractTag, inputTag, internalWrites, decodedTags, tags};
}

async function compress(transaction: Transaction) {
  const stringifiedTx = JSON.stringify(transaction);
  const gzipPromisified = util.promisify(gzip);
  const gzippedData = await gzipPromisified(stringifiedTx);

  return gzippedData;
}

async function uploadToBundlr(
  transaction: Transaction,
  bundlr: Bundlr,
  tags: GQLTagInterface[],
  logger: RedStoneLogger) {

  const uploadBenchmark = Benchmark.measure();
  const gzippedData = await compress(transaction);

  const bTx = bundlr.createTransaction(gzippedData, {tags});
  await bTx.sign();

  // TODO: move uploading to a separate Worker, to increase TPS
  const bundlrResponse = await bTx.upload();
  logger.debug("Uploading to bundlr", uploadBenchmark.elapsed());
  logger.debug("Bundlr response id", bundlrResponse.data.id);

  return {bTx, bundlrResponse};
}


async function createSortKey(
  arweave: Arweave,
  jwk: JWKInterface,
  blockId: string,
  mills: number,
  transactionId: string,
  blockHeight: number) {

  const blockHashBytes = arweave.utils.b64UrlToBuffer(blockId);
  const txIdBytes = arweave.utils.b64UrlToBuffer(transactionId);
  const jwkDBytes = arweave.utils.b64UrlToBuffer(jwk.d as string);
  const concatenated = arweave.utils.concatBuffers([blockHashBytes, txIdBytes, jwkDBytes]);
  const hashed = arrayToHex(await arweave.crypto.hash(concatenated));
  const blockHeightString = `${blockHeight + 1}`.padStart(12, '0');

  return `${blockHeightString},${mills},${hashed}`;
}
