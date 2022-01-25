import Router from "@koa/router";
import {
  Benchmark,
  GQLEdgeInterface,
  GQLNodeInterface, GQLTagInterface,
  LexicographicalInteractionsSorter,
  TagsParser
} from "redstone-smartweave";
import Transaction from "arweave/node/lib/transaction";
import {Knex} from "knex";
import {parseFunctionName} from "../../tasks/syncTransactions";
import {BlockData} from "arweave/node/blocks";

export async function sequencerRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb, arweave, bundlr} = ctx;

  const transaction: Transaction = new Transaction({...ctx.request.body});

  logger.info("New sequencer tx", transaction.id);

  const originalSignature = transaction.signature;
  const originalOwner = transaction.owner;
  const originalAddress = await arweave.wallets.ownerToAddress(originalOwner);

  const sorter = new LexicographicalInteractionsSorter(arweave);

  const networkInfo = await arweave.network.getInfo();
  const blockInfo: BlockData = await arweave.blocks.get(networkInfo.current);

  const currentHeight = networkInfo.height;
  const currentBlockId = networkInfo.current;
  const sortKey = await sorter.createSortKey(currentBlockId, transaction.id, currentHeight);

  let contractTag: string = '', inputTag: string = '';

  const decodedTags: GQLTagInterface[] = [];

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
    {name: "Sequencer-Sort-Key", value: sortKey},
    {name: "Sequencer-Tx-Id", value: transaction.id},
    {name: "Sequencer-Block-Height", value: "" + currentHeight},
    {name: "Sequencer-Block-Id", value: currentBlockId},
    ...decodedTags
  ];

  const bTx = bundlr.createTransaction(JSON.stringify(transaction), {tags});

  await bTx.sign();
  const bundlrResponse = await bTx.upload();
  logger.debug("Bundlr response id", bundlrResponse.data.id);

  logger.debug("Inserting into sequencer table");

  try {
    await gatewayDb("sequencer")
      .insert({
        original_sig: originalSignature,
        original_owner: originalOwner,
        original_address: originalAddress,
        sequence_block_id: currentBlockId,
        sequence_block_height: currentHeight,
        sequence_transaction_id: transaction.id,
        bundler_tx_id: bTx.id,
        bundler_response: JSON.stringify(bundlrResponse.data)
      });

    const interaction: any = {
      id: transaction.id,
      owner: {address: transaction.owner},
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
      sortKey: sortKey
    }

    logger.debug("Inserting into interactions table");
    await gatewayDb("interactions")
      .insert({
        interaction_id: transaction.id, //hmm, or bundlr tx id?
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
      });

    logger.info("Transaction successfully bundled", {
      id: transaction.id,
      bundled_tx_id: bTx.id
    });

    ctx.body = bundlrResponse.data;
  } catch (e) {
    logger.error("Error while inserting bundled transaction", bundlrResponse.data.id);
    logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }


}
