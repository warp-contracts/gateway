import Router from "@koa/router";
import Transaction from "arweave/node/lib/transaction";
import {parseFunctionName} from "../../tasks/syncTransactions";
import Arweave from "arweave";
import {JWKInterface} from "arweave/node/lib/wallet";
import {arrayToHex, Benchmark, GQLTagInterface} from "redstone-smartweave";
import {cachedBlockInfo, cachedNetworkInfo} from "../../tasks/networkInfoCache";

export async function sequencerRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb, arweave, bundlr, jwk} = ctx;

  const benchmark = Benchmark.measure();

  const transaction: Transaction = new Transaction({...ctx.request.body});

  logger.debug("New sequencer tx", transaction.id);

  const originalSignature = transaction.signature;
  const originalOwner = transaction.owner;
  const originalAddress = await arweave.wallets.ownerToAddress(originalOwner);

  const networkInfoBenchmark = Benchmark.measure();

  try {
    const networkInfo = cachedNetworkInfo
      ? cachedNetworkInfo
      : await arweave.network.getInfo()

    const blockInfo = cachedBlockInfo
      ? cachedBlockInfo
      : await arweave.blocks.get(networkInfo.current)

    logger.debug("Network info:", networkInfoBenchmark.elapsed());

    const millis = Date.now();

    const currentHeight = networkInfo.height;
    if (!currentHeight) {
      throw new Error("Current height not set");
    }

    const currentBlockId = networkInfo.current;
    if (!currentBlockId) {
      throw new Error("Current block not set");
    }

    const sortKeyBench = Benchmark.measure();

    const sortKey = await createSortKey(arweave, jwk, currentBlockId, millis, transaction.id, currentHeight);

    logger.debug("Sort Key generation", sortKeyBench.elapsed());

    let contractTag: string = '', inputTag: string = '';

    const decodedTags: GQLTagInterface[] = [];

    const tagsBenchmark = Benchmark.measure();

    transaction.tags.forEach(tag => {
      const key = tag.get('name', {decode: true, string: true});
      const value = tag.get('value', {decode: true, string: true});
      if (key == 'Contract') {
        contractTag = value;
      }
      if (key == 'Input') {
        inputTag = value;
      }
      decodedTags.push({
        name: key,
        value: value // TODO: handle array-ish values
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
      ...decodedTags
    ];

    logger.debug("Sequencer Tags generation", tagsBenchmark.elapsed());

    // TODO: add fallback to other bundlr nodes.
    const uploadBenchmark = Benchmark.measure();
    const bTx = bundlr.createTransaction(JSON.stringify(transaction), {tags});
    await bTx.sign();

    // TODO: move uploading to a separate Worker, to increase TPS
    const bundlrResponse = await bTx.upload();
    logger.debug("Uploading to bundlr", uploadBenchmark.elapsed());
    logger.debug("Bundlr response id", bundlrResponse.data.id);

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
          function: parseFunctionName(inputTag, logger),
          input: inputTag,
          confirmation_status: "confirmed",
          confirming_peer: "https://node1.bundlr.network",
          source: "redstone-sequencer",
          bundler_tx_id: bTx.id
        })
    ]);


    logger.debug("Inserting into tables", insertBench.elapsed());

    logger.debug("Transaction successfully bundled", {
      id: transaction.id,
      bundled_tx_id: bTx.id
    });

    ctx.body = bundlrResponse.data;
    logger.info("Total sequencer processing", benchmark.elapsed());
  } catch (e) {
    logger.error("Error while inserting bundled transaction");
    logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }

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
  const blockHeightString = `${blockHeight}`.padStart(12, '0');

  return `${blockHeightString},${mills},${hashed}`;
}
