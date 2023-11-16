const fs = require('fs');
const warpContracts = require('warp-contracts-old');
const warpContractsNew = require('warp-contracts-new');
const { EthereumSigner } = require('warp-contracts-plugin-signature/server');

let errors_l1 = ``;
let errors_l2 = ``;

const warp = warpContracts.WarpFactory.forMainnet({
  ...warpContracts.defaultCacheOptions,
  dbLocation: 'warp/old',
}).useGwUrl('http://35.242.203.146:5666');
const warpNew = warpContractsNew.WarpFactory.forMainnet({
  ...warpContractsNew.defaultCacheOptions,
  dbLocation: 'warp/new',
}).useGwUrl('http://35.242.203.146:5666');
const wallet = readJSON('./.secrets/warp-wallet-jwk.json');
const ethWallet = fs.readFileSync('./.secrets/ethereum-priv-key.txt', 'utf-8').replace(/\n/g, '');

warpContracts.LoggerFactory.INST.logLevel('error');
warpContractsNew.LoggerFactory.INST.logLevel('error');

const contractB = warp
  .contract('YhTW-jV7ffbYciz1bcJ-SM-79cmt9MkoZYutyaghg9Y')
  .setEvaluationOptions({
    sequencerUrl: 'http://35.242.203.146:5666/',
  })
  .connect(wallet);

const contractC = warp
  .contract('-tU1YKqnwgzpZIxjqUPBzRFsCfXVNZ6t1lu5pi5cV3k')
  .setEvaluationOptions({
    sequencerUrl: 'http://35.242.203.146:5666/',
  })
  .connect(wallet);

const contractD = warpNew
  .contract('7AZv5bczZhJJpUfwhzjz3iGdzo2PaBi0elgoRwzwg4g')
  .setEvaluationOptions({
    sequencerUrl: 'http://35.242.203.146:5666/',
  })
  .connect(wallet);

const contractE = warpNew
  .contract('OsGmh1UtH4QytV0Tdxgg_TJ-VjfHkQYPLX7yuK1OfiQ')
  .setEvaluationOptions({
    sequencerUrl: 'http://35.242.203.146:5666/',
  })
  .connect(wallet);

const contractF = warpNew
  .contract('7AZv5bczZhJJpUfwhzjz3iGdzo2PaBi0elgoRwzwg4g')
  .setEvaluationOptions({
    sequencerUrl: 'http://35.242.203.146:5666/',
  })
  .connect(new EthereumSigner(ethWallet));

setInterval(async () => {
  console.log('sending to L2...');
  try {
    await Promise.all([
      /*contractB.writeInteraction({
        function: 'transfer',
        target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
        qty: 1,
      }),
      contractC.writeInteraction({
        function: 'transfer',
        target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
        qty: 1,
      }),*/
      contractD.writeInteraction({
        function: 'transfer',
        target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
        qty: 1,
      }),
      contractE.writeInteraction({
        function: 'transfer',
        target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
        qty: 1,
      }),
      /*contractF.writeInteraction({
        function: 'transfer',
        target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
        qty: 1,
      }),*/
    ]);
  } catch (e) {
    errors_l2 += `${e.stack}\n\n`;
  }
}, 3000);

/*
setInterval(async () => {
  console.log('sending to L1...');
  try {
    await Promise.all([
      contractB.writeInteraction(
        {
          function: 'transfer',
          target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
          qty: 1,
        },
        { disableBundling: true }
      ),
      contractC.writeInteraction(
        {
          function: 'transfer',
          target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
          qty: 1,
        },
        { disableBundling: true }
      ),
      contractD.writeInteraction(
        {
          function: 'transfer',
          target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
          qty: 1,
        },
        { disableBundling: true }
      ),
      contractE.writeInteraction(
        {
          function: 'transfer',
          target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
          qty: 1,
        },
        { disableBundling: true }
      ),
    ]);
  } catch (e) {
    errors_l1 += `${e.stack}\n\n`;
  }
}, 5000);
*/

setInterval(() => {
  saveErrors();
}, 3600000);

function saveErrors() {
  fs.appendFileSync(`errors_l1.txt`, errors_l1);
  fs.appendFileSync(`errors_l2.txt`, errors_l2);
  errors_l1 = ``;
  errors_l2 = ``;
}

process.on('SIGINT', () => {
  saveErrors();
  process.exit(-1);
});

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
