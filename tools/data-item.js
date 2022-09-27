const Arweave = require('arweave');
const {createData} = require("arbundles");
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
  console.log('Using warp jwk with address', warpJwkAddress);
  const bundlr = new Bundlr("https://node2.bundlr.network", 'arweave', warpJwk, {
    timeout: 5000,
  });

  // jwk used to sign the data-item
  const userJwk = await arweave.wallets.generate();

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
  const data = Math.random().toString().slice(-4);
  const dataItem = createData(
    data,
    userSigner,
    {tags}
  );
  await dataItem.sign(userSigner);

  const result = await bundlr.uploader.transactionUploader(dataItem);
  console.log(result.data);


}

main().finally(() => console.log("done"));