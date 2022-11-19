const Arweave = require('arweave');
const {createData, bundleAndSignData} = require("arbundles");
const Bundlr = require("@bundlr-network/client").default;
const fs = require("fs");
const {ArweaveSigner} = require("arbundles/src/signing");
const {SmartWeaveTags} = require("warp-contracts");

async function main() {
  const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https',
  });

  // jwk used to create the Bundlr client instance
  const warpJwk = JSON.parse(fs.readFileSync('.secrets/warp-wallet-jwk.json').toString());
  const warpJwkAddress = await arweave.wallets.jwkToAddress(warpJwk);
  console.log('creating Bundlr with jwk address', warpJwkAddress);
  const bundlr = new Bundlr("https://node1.bundlr.network", 'arweave', warpJwk, {
    timeout: 5000,
  });

  // jwk used to sign the data-item
  const userJwk = await arweave.wallets.generate()
  console.log('User wallet', await arweave.wallets.jwkToAddress(userJwk));

  const tags = [
    {name: SmartWeaveTags.APP_NAME, value: 'SmartWeaveAction'},
    {name: SmartWeaveTags.APP_VERSION, value: '0.3.0'},
    {name: SmartWeaveTags.SDK, value: 'Warp'},
    // the warp 9 token: https://sonar.warp.cc/#/app/contract/KT45jaf8n9UwgkEareWxPgLJk4oMWpI5NODgYVIF1fY
    {name: SmartWeaveTags.CONTRACT_TX_ID, value: 'KT45jaf8n9UwgkEareWxPgLJk4oMWpI5NODgYVIF1fY'},
    {
      name: SmartWeaveTags.INPUT, value: JSON.stringify({
        function: "mint"
      })
    }
  ];
  const userSigner = new ArweaveSigner(userJwk);
  const dataItem1 = createData(
    Math.random().toString().slice(-4),
    userSigner,
    {tags}
  );
  await dataItem1.sign(userSigner);
  console.log("dataItem1 id", dataItem1.id);
  console.log("dataItem1 owner", dataItem1.owner);
  console.log("dataItem1 wallet address", await arweave.wallets.ownerToAddress(dataItem1.owner));
  const result = await bundlr.uploader.transactionUploader(dataItem1);
  console.log(result.data);
}

main().finally(() => console.log("done"));

// -RGYTnzNe9cZYmj4Un0zUFDSCkMeqmeW0NmlsGmWMLM - bundle with one data-item (iN9MSwkn-5zjLwXOKMuJjrLENBYumIsUzrzi7eaTYC0)
// Ax3ocdUpesprt-J2Hc0VuzskKaTNjVgla7QfGfDP9B4 - bundle with three data-items (WOzSUJLXsFldUUb1QrKEuwOlVZrnEp9XloxxWvbAjRI, jDs8nPV3U3h82ho3O3xDH5QFQpvKGD0ii2MB6nfJBS4, u_Iei58HBL2rLZD3DfeRAs-6TyHMDZOSl7u17K6pf4Y)