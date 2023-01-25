import fs from 'fs';
import { JWKInterface } from 'arweave/node/lib/wallet';
import { defaultCacheOptions, LoggerFactory, SmartWeaveTags, WarpFactory } from 'warp-contracts';
import { createData, DataItem } from 'arbundles';
import { ArweaveSigner } from 'arbundles/src/signing';

async function main() {
  let wallet: JWKInterface = readJSON('.secrets/33F0QHcb22W7LwWR1iRC8Az1ntZG09XQ03YWuw2ABqA.json');

  try {
    const warp = WarpFactory.forMainnet({ ...defaultCacheOptions, inMemory: true });

    const initialState = {};
    const tags = [
      { name: SmartWeaveTags.APP_NAME, value: 'SmartWeaveContract' },
      { name: SmartWeaveTags.APP_VERSION, value: '0.3.0' },
    ];

    const contract = createData(JSON.stringify(initialState), new ArweaveSigner(wallet), { tags: tags });
    await contract.sign(new ArweaveSigner(wallet));
    console.log(contract.id);
    console.log(contract.isSigned());
    const raw = contract.getRaw();
    const newContract = new DataItem(raw);
    console.log(newContract.id);
    console.log(newContract.isSigned());
  } catch (e) {
    //logger.error(e)
    throw e;
  }
}

export function readJSON(path: string): JWKInterface {
  const content = fs.readFileSync(path, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`File "${path}" does not contain a valid JSON`);
  }
}

main().catch((e) => console.error(e));