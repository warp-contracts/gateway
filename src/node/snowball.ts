import axios from "axios";
import Router from "@koa/router";

const QUORUM_SIZE = 0.5;
const SAMPLE_SIZE = 2;
const DECISION_THRESHOLD = 3;

const count = (array: string[]): { [item: string]: number } => {
  const counter: { [item: string]: number } = {};
  array.forEach((item) => (counter[item] = (counter[item] || 0) + 1));
  return counter;
};

export const snowball = async (
  ctx: Router.RouterContext,
  contractId: string,
  height: number,
  hash: string
) => {
  ctx.logger.info(`Starting snowball consensus on`, {
    contract: contractId,
    height,
    hash,
    params: {
      quorum: QUORUM_SIZE,
      peers_to_query: SAMPLE_SIZE,
      threshold: DECISION_THRESHOLD,
    },
  });

  const internalCounts: { [item: string]: number } = {};

  const peers: { id: string; address: string }[] = (
    await axios.get(`${ctx.network}/other-peers?askingNode=${ctx.nodeId}`)
  ).data;

  ctx.logger.debug("All active peers", peers);

  // https://docs.avax.network/learn/platform-overview/avalanche-consensus/#algorithm
  // https://ipfs.io/ipfs/QmUy4jh5mGNZvLkjies1RWM4YuvJh5o2FYopNPVYwrRVGV page 4., Figure 3.
  let decided = false;
  let preference = hash;
  let lastPreference = preference;
  let consecutiveSuccesses = 0;
  const votes: { ip: string; hash: string }[] = [];

  while (!decided) {
    const randomPeers = peers
      .sort(() => 0.5 - Math.random())
      .slice(0, SAMPLE_SIZE);

    for (const peer of randomPeers) {
      ctx.logger.info(`Querying ${peer.address}`);
      // TODO: Promise.allSettled.
      const { data: peerHash } = await axios.post(`${peer.address}/gossip`, {
        type: "query",
        contractId,
        height,
      });

      votes.push({ ip: peer.address, hash: peerHash });
      ctx.logger.info(`Hash returned: ${peerHash}`);
    }

    const votesCounts = count(votes.map((item) => item.hash));
    for (const [peerHash, amount] of Object.entries(votesCounts)) {
      if (amount >= QUORUM_SIZE * SAMPLE_SIZE) {
        internalCounts[peerHash] = (internalCounts[peerHash] || 0) + 1;

        if (internalCounts[peerHash] >= internalCounts[hash]) {
          preference = peerHash;

          if (preference !== lastPreference) {
            lastPreference = peerHash;
            consecutiveSuccesses = 0;
          } else {
            consecutiveSuccesses++;
            if (consecutiveSuccesses > DECISION_THRESHOLD) {
              decided = true;
              break;
            }
          }
        }
      }
    }
  }

  ctx.logger.info(`Accepted hash: ${preference}`);

  // TODO: now we have consensus - but what next?
  // how to mark the state as accepted on all peers?

  // TODO: sende some ARs (tokens) to nodes that
  // returned accepted state?

  // const ip = hashes.find((item) => item.hash === hash)?.ip;
  // TODO: Query for state + validity by hash that won the round
};
