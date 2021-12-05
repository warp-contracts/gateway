import Arweave from "arweave";

export const initArweave = (): Arweave => {
  return Arweave.init({
    host: "arweave.net",
    port: 443, // Port
    protocol: "https",
    timeout: 60000,
    logging: false,
  });
};
