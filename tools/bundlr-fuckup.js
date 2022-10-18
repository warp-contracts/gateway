const Arweave = require('arweave');
const Bundlr = require("@bundlr-network/client").default;
const fs = require("fs");
const {knex} = require("knex");

async function main() {
  const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https',
  });

  // jwk used to create the Bundlr client instance
  const warpJwk = JSON.parse(fs.readFileSync('.secrets/warp-wallet-jwk.json').toString());
  const warpJwkAddress = await arweave.wallets.jwkToAddress(warpJwk);
  console.log('Using warp jwk with address', warpJwkAddress);
  const bundlr = new Bundlr("https://node2.bundlr.network", 'arweave', warpJwk, {
    timeout: 5000,
  });

  const db = knex({
    client: 'pg',
    connection: process.env.DB_URL,
    useNullAsDefault: true,
    pool: {
      min: 5,
      max: 30,
      createTimeoutMillis: 3000,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 100,
      propagateCreateError: false,
    },
  });


}

main().finally(() => console.log("done"));

// -RGYTnzNe9cZYmj4Un0zUFDSCkMeqmeW0NmlsGmWMLM - bundle with one data-item (iN9MSwkn-5zjLwXOKMuJjrLENBYumIsUzrzi7eaTYC0)
// Ax3ocdUpesprt-J2Hc0VuzskKaTNjVgla7QfGfDP9B4 - bundle with three data-items (WOzSUJLXsFldUUb1QrKEuwOlVZrnEp9XloxxWvbAjRI, jDs8nPV3U3h82ho3O3xDH5QFQpvKGD0ii2MB6nfJBS4, u_Iei58HBL2rLZD3DfeRAs-6TyHMDZOSl7u17K6pf4Y)