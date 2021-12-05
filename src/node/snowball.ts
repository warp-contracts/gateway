import axios, { AxiosResponse } from "axios";
import Router from "@koa/router";
import { GossipQueryResult } from "./routes/gossip";

const QUORUM_SIZE = 0.6;
const SAMPLE_SIZE = 4;
const DECISION_THRESHOLD = 1;

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
  // TODO: add funny snowball icon %)
  // - What are you, eight?
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

  const activePeers: { id: string; address: string }[] = (
    await axios.get(`${ctx.network}/other-peers?askingNode=${ctx.nodeId}`)
  ).data;

  ctx.logger.debug("All active peers", activePeers);

  // https://docs.avax.network/learn/platform-overview/avalanche-consensus/#algorithm
  // https://ipfs.io/ipfs/QmUy4jh5mGNZvLkjies1RWM4YuvJh5o2FYopNPVYwrRVGV page 4., Figure 3.
  let decided = false;
  let preference = hash;
  let lastPreference = preference;
  let consecutiveSuccesses = 0;
  const votes: { ip: string; hash: string }[] = [];

  while (!decided) {
    // TODO: round-robin? weighted round-robin based on nodes reputation?
    const randomPeers = activePeers
      .sort(() => 0.5 - Math.random())
      .slice(0, SAMPLE_SIZE);

    ctx.logger.info(
      "Querying peers",
      randomPeers.map((p) => p.address)
    );

    const peersQuery: Promise<AxiosResponse<GossipQueryResult>>[] =
      randomPeers.map((peer) => {
        return axios.post(`${peer.address}/gossip`, {
          type: "query",
          contractId,
          height,
        });
      });

    const peersQueryResult = await Promise.allSettled(peersQuery);
    peersQueryResult.forEach((result) => {
      if (result.status === "fulfilled") {
        const data = result.value.data;
        votes.push({ ip: data.peer.address, hash: data.hash });
        ctx.logger.debug(`Hash returned:`, data);
      } else {
        ctx.logger.error(result.reason);
      }
    });

    const votesCounts = count(votes.map((item) => item.hash));
    for (const [peerHash, amount] of Object.entries(votesCounts)) {
      if (amount >= QUORUM_SIZE * SAMPLE_SIZE) {
        internalCounts[peerHash] = (internalCounts[peerHash] || 0) + 1;

        if (internalCounts[peerHash] >= internalCounts[preference]) {
          preference = peerHash;

          if (preference !== lastPreference) {
            ctx.logger.info("[snowball] Preference change", {
              from: lastPreference,
              to: peerHash,
            });
            lastPreference = peerHash;
            consecutiveSuccesses = 0;
          } else {
            consecutiveSuccesses++;
            ctx.logger.info(
              "[snowball] consecutive successes",
              consecutiveSuccesses
            );
            if (consecutiveSuccesses > DECISION_THRESHOLD) {
              decided = true;
              break;
            }
          }
        }
      }
    }
  }

  ctx.logger.info(`[snowball] Consensus: ${preference}`);

  // TODO: now we have consensus - but what next?
  // how to mark the state as accepted on all peers?

  // TODO: send some ARs (tokens?) to nodes that
  // returned accepted state?
  // or - send metrics to smart contract and let
  // the smart contract decide re. bounties?

  // const ip = hashes.find((item) => item.hash === hash)?.ip;
  // TODO: Query for state + validity by hash that won the round
};
