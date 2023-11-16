const fs = require('fs');
const warpContractsNew = require('warp-contracts-new');
const { DeployPlugin } = require("warp-contracts-plugin-deploy");
const { ArweaveSigner } = require("warp-arbundles");

const warpNew = warpContractsNew.WarpFactory.forMainnet({
  ...warpContractsNew.defaultCacheOptions,
  dbLocation: 'warp/new',
})
  .use(new DeployPlugin())
  .useGwUrl('http://35.242.203.146:5666');
const wallet = readJSON('./.secrets/33F0QHcb22W7LwWR1iRC8Az1ntZG09XQ03YWuw2ABqA.json');

warpContractsNew.LoggerFactory.INST.logLevel('error');

async function doDeploy() {
  try {
    const { contractTxId } = await warpNew.deploy({
      wallet: new ArweaveSigner(wallet),
      initState: JSON.stringify({}),
      src: 'export async function handle(state, action){}'
    });
    console.log("new contract", contractTxId);
  } catch(e) {
    console.error(e);
  }
}

doDeploy().finally(() => console.log("done"));


function readJSON(path) {
  const content = fs.readFileSync(path, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`File "${path}" does not contain a valid JSON`);
  }
}

process.on('uncaughtException', () => {
  console.error('uncaughtException');
});

process.on('unhandledRejection', (e) => {
  console.error('unhandledRejection');
});
