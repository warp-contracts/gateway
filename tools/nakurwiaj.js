const fs = require("fs");

const warpContracts = require("warp-contracts");
const warp = warpContracts.WarpFactory.forTestnet();
const wallet = readJSON('./.secrets/33F0QHcb22W7LwWR1iRC8Az1ntZG09XQ03YWuw2ABqA.json');

warpContracts.LoggerFactory.INST.logLevel('error');

const contractA = warp.contract("IBrkOF0A8XqlZHVFtZXy7jfCJFcaLJ2XYp94xL1-yUc")
  .setEvaluationOptions({
    sequencerUrl: 'http://34.141.17.15:5666/'
  })
  .connect(wallet);

const contractB = warp.contract("1LsbT8HH8SbldveeZcZZwgmuLn0ueJ6pN7ZSrbTqeVU")
  .setEvaluationOptions({
    sequencerUrl: 'http://34.141.17.15:5666/'
  })
  .connect(wallet);

const contractC = warp.contract("o-QYGKa6rkWj5i0Vx0VQy99myCkPNeCAJi6-UZnhIVU")
  .setEvaluationOptions({
    sequencerUrl: 'http://34.141.17.15:5666/'
  })
  .connect(wallet);

const contractD = warp.contract("Y8ngFNyfGo17FeSvB7NEzLxdjl-qpFlE1YIPM8Sa6fo")
  .setEvaluationOptions({
    sequencerUrl: 'http://34.141.17.15:5666/'
  })
  .connect(wallet);

const contractE = warp.contract("pxna6TxgVFaESLNu0uZvxeUMOSqoYL1n-RRLtk7mGjY")
  .setEvaluationOptions({
    sequencerUrl: 'http://34.141.17.15:5666/'
  })
  .connect(wallet);


setInterval(async () => {
  console.log('sending...');
  await Promise.all([
    contractA.writeInteraction({
      function: 'transfer',
      target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
      qty: 100
    }),
    contractB.writeInteraction({
      function: 'transfer',
      target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
      qty: 100
    }),
    contractC.writeInteraction({
      function: 'transfer',
      target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
      qty: 100
    }),
    contractD.writeInteraction({
      function: 'transfer',
      target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
      qty: 100
    }),
    contractE.writeInteraction({
      function: 'transfer',
      target: 'M-mpNeJbg9h7mZ-uHaNsa5jwFFRAq0PsTkNWXJ-ojwI',
      qty: 100
    })

  ]);
}, 500);

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