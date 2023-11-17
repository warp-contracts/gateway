import Router from '@koa/router';
import { contractsRoute } from './routes/contracts/contractsRoute';
import { interactionsRoute } from './routes/interactions/interactionsRoute';
import { searchRoute } from './routes/searchRoute';
import { totalTxsRoute } from './routes/stats/totalTxsRoute';
import { contractRoute } from './routes/contracts/contractRoute';
import { contractWithSourceRoute } from './routes/contracts/contractWithSourceRoute';
import { contractWithSourceRoute_v2 } from './routes/contracts/contractWithSourceRoute_v2';
import { interactionRoute } from './routes/interactions/interactionRoute';
import { sequencerAddressRoute } from './routes/sequencerAddress'
import { sequencerRoute } from './routes/sequencerRoute';
import { sequencerRoute_v2 } from './routes/sequencerRoute_v2';
import { interactionsStreamRoute } from './routes/interactions/interactionsStreamRoute';
import { deployContractRoute } from './routes/deploy/deployContractRoute';
import { arweaveBlockRoute, arweaveInfoRoute } from './routes/arweaveInfoRoute';
import { interactionsSortKeyRoute } from './routes/interactions/interactionsSortKeyRoute';
import { contractDataRoute } from './routes/contracts/contractDataRoute';
import { nftsOwnedByAddressRoute } from './routes/nftsOwnedByAddressRoute';
import { txsPerDayRoute } from './routes/stats/txsPerDayRoute';
import { interactionsSortKeyRoute_v2 } from './routes/interactions/interactionsSortKeyRoute_v2';
import { contractSourceRoute } from './routes/contracts/contractSourceRoute';
import { contractsBySourceRoute } from './routes/contracts/contractsBySourceRoute';
import { creatorRoute } from './routes/creatorRoute';
import { interactionsSonar } from './routes/interactions/interactionsSonar';
import { deployBundledRoute } from './routes/deploy/deployBundledRoute';
import { deploySourceRoute } from './routes/deploy/deploySourceRoute';
import { deploySourceRoute_v2 } from './routes/deploy/deploySourceRoute_v2';
import { deployContractRoute_v2 } from './routes/deploy/deployContractRoute_v2';
import { registerContractRoute } from './routes/deploy/registerContractRoute';
import { dashboardRoute } from './routes/dashboardRoute';
import { gcpAliveRoute } from './routes/gcpAliveRoute';
import { contractsByTags } from './routes/contracts/contractsByTags';

const gatewayRouter = (replica: boolean): Router => {
  const router = new Router({ prefix: '/gateway' });
  // get
  router.get('/contracts', contractsRoute);
  router.get('/contract', contractWithSourceRoute);
  router.get('/v2/contract', contractWithSourceRoute_v2);
  router.get('/contract-data/:id', contractDataRoute);
  router.get('/contracts/:id', contractRoute);
  router.get('/dashboard', dashboardRoute);
  router.get('/search/:phrase', searchRoute);
  router.get('/nft/owner/:address', nftsOwnedByAddressRoute);
  // separate "transactionId" route to make caching in cloudfront possible
  router.get('/interactions/transactionId', interactionsRoute);
  router.get('/interactions', interactionsRoute);
  // adding temporarily - https://github.com/redstone-finance/redstone-sw-gateway/pull/65#discussion_r880555807
  router.get('/interactions-sonar', interactionsSonar);
  router.get('/interactions-sort-key', interactionsSortKeyRoute);
  router.get('/v2/interactions-sort-key', interactionsSortKeyRoute_v2);
  router.get('/interactions-stream', interactionsStreamRoute);
  router.get('/interactions/:id', interactionRoute);
  router.get('/stats', totalTxsRoute);
  router.get('/stats/per-day', txsPerDayRoute);
  router.get('/arweave/info', arweaveInfoRoute);
  router.get('/arweave/block', arweaveBlockRoute);
  router.get('/contract-source', contractSourceRoute);
  router.get('/contracts-by-source', contractsBySourceRoute);
  router.get('/creator', creatorRoute);
  router.get('/gcp/alive', gcpAliveRoute);
  router.get('/sequencer/address', sequencerAddressRoute)
  router.get('/contracts-by-tags', contractsByTags);

  // post
  if (!replica) {
    router.post('/sequencer/register', sequencerRoute);
    router.post('/v2/sequencer/register', sequencerRoute_v2);
    router.post('/contracts/deploy', deployContractRoute);
    router.post('/contracts/deploy-bundled', deployBundledRoute);
    router.post('/sources/deploy', deploySourceRoute);
    router.post('/v2/sources/deploy', deploySourceRoute_v2);
    router.post('/v2/contracts/deploy', deployContractRoute_v2);
    router.post('/contracts/register', registerContractRoute);
  }

  return router;
};

export default gatewayRouter;
