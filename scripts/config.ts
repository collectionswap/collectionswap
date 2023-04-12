import type { BigNumberish } from "ethers";

type Config = {
  USE_LEDGER: boolean;
  USE_SAFE: boolean;
  VRF_COORDINATOR: string;
  SUBSCRIPTION_ID: BigNumberish; // Create subscription account at vrf.chain.link
  KEY_HASH: string; // See Gwei KeyHashes at https://docs.chain.link/docs/vrf/v2/subscription/supported-networks/#configurations
  PROTOCOL_FEE_MULTIPLIER: string; // Will be multiplied by 1e18 (100%): 0.005 = 0.5%
  CARRY_FEE_MULTIPLIER: string; // Will be multiplied by 1e18 (100%): 0.005 = 0.5%
  EXISTING_COLLECTIONSWAP?: string;
  EXISTING_COLLECTIONSTAKER?: string;
  EXISTING_RNG?: string;
};

const baseConfig = {
  USE_LEDGER: false,
  USE_SAFE: false,
  PROTOCOL_FEE_MULTIPLIER: "0",
  CARRY_FEE_MULTIPLIER: "0",
};

export const configs: { [key: number]: Config } = {
  // Mainnet
  1: {
    USE_LEDGER: true,
    USE_SAFE: true,
    VRF_COORDINATOR: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
    KEY_HASH:
      "0x8af398995b04c28e9951adb9721ef74c74f93e6a478f39e7e0777be13527e7ef",
    SUBSCRIPTION_ID: 538,
    PROTOCOL_FEE_MULTIPLIER: "0",
    CARRY_FEE_MULTIPLIER: "0",
    EXISTING_COLLECTIONSWAP: "0x226620C03C2f2dBBBd90E2Eca4754D8a41Fd3DEB",
    EXISTING_COLLECTIONSTAKER: "0x7DEC8F08567a284A1354AEb95977bE1a0DEDC4fb",
    EXISTING_RNG: "0xB38DDf6914717674500425e18024806C31250725",
  },
  // Goerli
  5: {
    ...baseConfig,
    USE_SAFE: true,
    VRF_COORDINATOR: "0x2Ca8E0C643bDe4C2E08ab1fA0da3401AdAD7734D",
    KEY_HASH:
      "0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15",
    SUBSCRIPTION_ID: 6344,
  },
  // Hardhat
  31337: {
    ...baseConfig,
    VRF_COORDINATOR: "0x2Ca8E0C643bDe4C2E08ab1fA0da3401AdAD7734D",
    KEY_HASH:
      "0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15",
    SUBSCRIPTION_ID: "1234",
  },
  // Mumbai
  80001: {
    ...baseConfig,
    USE_LEDGER: false,
    VRF_COORDINATOR: "0x7a1BaC17Ccc5b313516C5E16fb24f7659aA5ebed",
    KEY_HASH:
      "0x4b09e658ed251bcafeebbc69400383d49f344ace09b9576fe248bb02c003fe9f",
    SUBSCRIPTION_ID: "1234",
  },
  // Base-Goerli
  84531: {
    ...baseConfig,
    USE_LEDGER: false,
    USE_SAFE: true,
    // VRF_COORDINATOR: "",
    // KEY_HASH: "",
    // SUBSCRIPTION_ID: "",
  }
};
