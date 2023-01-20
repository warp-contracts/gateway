import { Warp, WarpFactory } from 'warp-contracts';

const warp = WarpFactory.forMainnet();

const contract = warp.contract(contractTxId).connect(jwk);

const { originalTxId } = await contract.writeInteraction({ function: 'helloWrite', name: 'Asia' });
