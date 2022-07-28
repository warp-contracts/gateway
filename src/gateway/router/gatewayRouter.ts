import Router from '@koa/router';
import { contractsRoute } from './routes/contractsRoute';
import { interactionsRoute } from './routes/interactionsRoute';
import { searchRoute } from './routes/searchRoute';
import { totalTxsRoute } from './routes/stats/totalTxsRoute';
import { contractRoute } from './routes/contractRoute';
import { contractWithSourceRoute } from './routes/contractWithSourceRoute';
import { interactionRoute } from './routes/interactionRoute';
import { safeContractsRoute } from './routes/safeContractsRoute';
import { sequencerRoute } from './routes/sequencerRoute';
import { interactionsStreamRoute } from './routes/interactionsStreamRoute';
import { deployContractRoute } from './routes/deployContractRoute';
import { arweaveBlockRoute, arweaveInfoRoute } from './routes/arweaveInfoRoute';
import { interactionsSortKeyRoute } from './routes/interactionsSortKeyRoute';
import { contractDataRoute } from './routes/contractDataRoute';
import { nftsOwnedByAddressRoute } from './routes/nftsOwnedByAddressRoute';
import { txsPerDayRoute } from './routes/stats/txsPerDayRoute';
import { interactionsContractGroupsRoute } from './routes/interactionsContractGroupsRoute';
import { interactionsSortKeyRoute_v2 } from './routes/interactionsSortKeyRoute_v2';
import { contractSourceRoute } from './routes/contractSourceRoute';
import { contractsBySourceRoute } from './routes/contractsBySourceRoute';

const gatewayRouter = new Router({ prefix: '/gateway' });

// get
gatewayRouter.get('/contracts', contractsRoute);
gatewayRouter.get('/contract', contractWithSourceRoute);
gatewayRouter.get('/contract-data/:id', contractDataRoute);
gatewayRouter.get('/contracts/:id', contractRoute);
gatewayRouter.get('/contracts-safe', safeContractsRoute);
gatewayRouter.get('/search/:phrase', searchRoute);
gatewayRouter.get('/nft/owner/:address', nftsOwnedByAddressRoute);
// separate "transactionId" route to make caching in cloudfront possible
gatewayRouter.get('/interactions/transactionId', interactionsRoute);
gatewayRouter.get('/interactions', interactionsRoute);
// adding temporarily - https://github.com/redstone-finance/redstone-sw-gateway/pull/65#discussion_r880555807
gatewayRouter.get('/interactions-sort-key', interactionsSortKeyRoute);
gatewayRouter.get('/v2/interactions-sort-key', interactionsSortKeyRoute_v2);
gatewayRouter.get('/interactions-stream', interactionsStreamRoute);
gatewayRouter.get('/interactions-contract-groups', interactionsContractGroupsRoute);
gatewayRouter.get('/interactions/:id', interactionRoute);
gatewayRouter.get('/stats', totalTxsRoute);
gatewayRouter.get('/stats/per-day', txsPerDayRoute);
gatewayRouter.get('/arweave/info', arweaveInfoRoute);
gatewayRouter.get('/arweave/block', arweaveBlockRoute);
gatewayRouter.get('/contract-source', contractSourceRoute);
gatewayRouter.get('/contracts-by-source', contractsBySourceRoute);

// post
gatewayRouter.post('/contracts/deploy', deployContractRoute);
gatewayRouter.post('/sequencer/register', sequencerRoute);

export default gatewayRouter;
