import { Knex } from "knex";
import { SmartWeave, SmartWeaveNodeFactory } from "redstone-smartweave";
import Arweave from "arweave";

export const sdk = async (db: Knex): Promise<SmartWeave> => {
  const arweave = Arweave.init({
    host: "arweave.net",
    port: 443, // Port
    protocol: "https",
    timeout: 60000,
    logging: false,
  });

  return await SmartWeaveNodeFactory.knexCached(arweave, db);
};
