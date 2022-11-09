type Config = {
  USE_LEDGER: boolean;
  FACTORY: string;
  VRF_COORDINATOR: string;
  SUBSCRIPTION_ID: string; // Create subscription account at vrf.chain.link
  KEY_HASH: string, // see Gwei KeyHashes at https://docs.chain.link/docs/vrf/v2/subscription/supported-networks/#configurations
  EXPORT_FILENAME: string;
};

export const configs: { [key: number]: Config } = {
  // Mainnet
  1: {
    USE_LEDGER: true,
    FACTORY: "0xb16c1342E617A5B6E4b631EB114483FDB289c0A4",
    VRF_COORDINATOR: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
    KEY_HASH: "0x8af398995b04c28e9951adb9721ef74c74f93e6a478f39e7e0777be13527e7ef",
    SUBSCRIPTION_ID: "",
    EXPORT_FILENAME: "mainnetAddresses.json",
  },
  // Goerli
  5: {
    USE_LEDGER: false,
    FACTORY: "0xF0202E9267930aE942F0667dC6d805057328F6dC",
    VRF_COORDINATOR: "0x2Ca8E0C643bDe4C2E08ab1fA0da3401AdAD7734D",
    KEY_HASH: "0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15",
    SUBSCRIPTION_ID: "",
    EXPORT_FILENAME: "goerliAddresses.json",
  },
  // Rinkeby (Deprecated)
  // 4: {
  //   USE_LEDGER: false,
  //   FACTORY: "0xcB1514FE29db064fa595628E0BFFD10cdf998F33",
  //   EXPORT_FILENAME: "rinkebyAddresses.json",
  // },
  // Hardhat
  31337: {
    USE_LEDGER: false,
    FACTORY: "",
    VRF_COORDINATOR: "",
    KEY_HASH: "",
    SUBSCRIPTION_ID: "",
    EXPORT_FILENAME: "hardhatAddresses.json",
  },
};
