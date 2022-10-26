type Config = {
  USE_LEDGER: boolean;
  FACTORY: string;
  EXPORT_FILENAME: string;
};

export const configs: { [key: number]: Config } = {
  // Mainnet
  1: {
    USE_LEDGER: true,
    FACTORY: "0xb16c1342E617A5B6E4b631EB114483FDB289c0A4",
    EXPORT_FILENAME: "mainnetAddresses.json",
  },
  // Rinkeby
  4: {
    USE_LEDGER: false,
    FACTORY: "0xcB1514FE29db064fa595628E0BFFD10cdf998F33",
    EXPORT_FILENAME: "rinkebyAddresses.json",
  },
  // Hardhat
  31337: {
    USE_LEDGER: false,
    FACTORY: "",
    EXPORT_FILENAME: "hardhatAddresses.json",
  },
};
