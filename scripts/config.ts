import { BigNumberish } from 'ethers'
type Config = {
  USE_LEDGER: boolean;
  VRF_COORDINATOR: string;
  SUBSCRIPTION_ID: BigNumberish; // Create subscription account at vrf.chain.link
  KEY_HASH: string, // see Gwei KeyHashes at https://docs.chain.link/docs/vrf/v2/subscription/supported-networks/#configurations
  PROTOCOL_FEE_MULTIPLIER: string; // Will be multiplied by 1e18 (100%): 0.005 = 0.5%
  CARRY_FEE_MULTIPLIER: string; // Will be multiplied by 1e18 (100%): 0.005 = 0.5%
  EXPORT_FILENAME: string;
  EXISTING_COLLECTIONSWAP?: string;
  EXISTING_COLLECTIONSTAKER?: string;
  EXISTING_RNG?: string;
};

export const configs: { [key: number]: Config } = {
  // Mainnet
  1: {
    USE_LEDGER: true,
    VRF_COORDINATOR: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
    KEY_HASH: "0x8af398995b04c28e9951adb9721ef74c74f93e6a478f39e7e0777be13527e7ef",
    SUBSCRIPTION_ID: 538,
    PROTOCOL_FEE_MULTIPLIER: "0.005",
    CARRY_FEE_MULTIPLIER: "0.005",
    EXPORT_FILENAME: "mainnetAddresses.json",
    EXISTING_COLLECTIONSWAP: "0x226620C03C2f2dBBBd90E2Eca4754D8a41Fd3DEB",
    EXISTING_COLLECTIONSTAKER: "0x7DEC8F08567a284A1354AEb95977bE1a0DEDC4fb",
    EXISTING_RNG: "0xB38DDf6914717674500425e18024806C31250725",
  },
  // Goerli
  5: {
    USE_LEDGER: false,
    VRF_COORDINATOR: "0x2Ca8E0C643bDe4C2E08ab1fA0da3401AdAD7734D",
    KEY_HASH: "0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15",
    SUBSCRIPTION_ID: 6344,
    PROTOCOL_FEE_MULTIPLIER: "0.005",
    CARRY_FEE_MULTIPLIER: "0.005",
    EXPORT_FILENAME: "goerliAddresses.json"
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
    VRF_COORDINATOR: "0x2Ca8E0C643bDe4C2E08ab1fA0da3401AdAD7734D",
    KEY_HASH: "0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15",
    SUBSCRIPTION_ID: "1234",
    PROTOCOL_FEE_MULTIPLIER: "0.005",
    CARRY_FEE_MULTIPLIER: "0.005",
    EXPORT_FILENAME: "hardhatAddresses.json"
  },
};
