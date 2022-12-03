/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * This file archives all currently unused functionality
 */
import { ethers } from "ethers";

import type {
  LSSVMPairFactory,
  Alchemy,
  ExponentialCurve,
} from "../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber, ContractTransaction, ContractReceipt } from "ethers";

// https://ethereum.stackexchange.com/questions/4086/how-are-enums-converted-to-uint
async function directAMMPoolCreation(
  connectToThisAccount: SignerWithAddress,
  lssvmPairFactory: LSSVMPairFactory,
  nftContractCollection: Alchemy,
  curve: ExponentialCurve,
  assetRecipient: string,
  poolType: number,
  delta: BigNumber,
  fee: BigNumber,
  spotPrice: BigNumber,
  initialNFTIDs: number[]
) {
  const lssvmPairETHContractTx: ContractTransaction = await lssvmPairFactory
    .connect(connectToThisAccount)
    .createPairETH(
      nftContractCollection.address,
      curve.address,
      assetRecipient,
      poolType,
      delta,
      fee,
      spotPrice,
      initialNFTIDs,
      {
        value: ethers.BigNumber.from(`${1.2e18}`),
        gasLimit: 1000000,
      }
    );
  // https://stackoverflow.com/questions/68432609/contract-event-listener-is-not-firing-when-running-hardhat-tests-with-ethers-js
  const lssvmPairETHContractReceipt: ContractReceipt =
    await lssvmPairETHContractTx.wait();
  const newPoolEvent = lssvmPairETHContractReceipt.events?.find(
    (event) => event.event === "NewPair"
  );
  const newPoolAddress = newPoolEvent?.args?.poolAddress;
  // Const lssvmPairETH = lssvmPairETHContractTx

  return {
    lssvmPairETHContractTx,
    lssvmPairETHContractReceipt,
    newPoolEvent,
    newPoolAddress,
  };
}
