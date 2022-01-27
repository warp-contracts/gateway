import Router from "@koa/router";
import Transaction from "arweave/node/lib/transaction";
import {parseFunctionName} from "../../tasks/syncTransactions";
import {BlockData} from "arweave/node/blocks";
import Arweave from "arweave";
import {JWKInterface} from "arweave/node/lib/wallet";
import {arrayToHex, GQLTagInterface} from "redstone-smartweave";

export async function sequencerRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb, arweave, bundlr, jwk} = ctx;

  const transaction: Transaction = new Transaction({...ctx.request.body});

  logger.info("New sequencer tx", transaction.id);

  const originalSignature = transaction.signature;
  const originalOwner = transaction.owner;
  const originalAddress = await arweave.wallets.ownerToAddress(originalOwner);

  const networkInfo = await arweave.network.getInfo();
  const blockInfo: BlockData = await arweave.blocks.get(networkInfo.current);

  const millis = Date.now();

  const currentHeight = networkInfo.height;
  const currentBlockId = networkInfo.current;
  const sortKey = await createSortKey(arweave, jwk, currentBlockId, millis, transaction.id, currentHeight);

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
    {name: "Sequencer-Mills", value: "" + millis},
    {name: "Sequencer-Sort-Key", value: sortKey},
    {name: "Sequencer-Tx-Id", value: transaction.id},
    {name: "Sequencer-Block-Height", value: "" + currentHeight},
    {name: "Sequencer-Block-Id", value: currentBlockId},
    ...decodedTags
  ];

  // TODO: add fallback to 2nd bundlr node.
  const bTx = bundlr.createTransaction(JSON.stringify(transaction), {tags});

  await bTx.sign();
  const bundlrResponse = await bTx.upload();
  logger.debug("Bundlr response id", bundlrResponse.data.id);

  try {
    logger.debug("Inserting into sequencer table");
    await gatewayDb("sequencer")
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
      });

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

export async function createSortKey(
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
