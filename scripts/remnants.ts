/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * This file archives all currently unused functionality
 */
import { ethers } from "ethers";

import type {
  CollectionPoolFactory,
  Alchemy,
  ExponentialCurve,
} from "../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber, ContractTransaction, ContractReceipt } from "ethers";

// https://ethereum.stackexchange.com/questions/4086/how-are-enums-converted-to-uint
async function directAMMPoolCreation(
  connectToThisAccount: SignerWithAddress,
  collectionPoolFactory: CollectionPoolFactory,
  nftContractCollection: Alchemy,
  curve: ExponentialCurve,
  assetRecipient: string,
  poolType: number,
  delta: BigNumber,
  fee: BigNumber,
  spotPrice: BigNumber,
  initialNFTIDs: number[]
) {
  const collectionPoolETHContractTx: ContractTransaction =
    await collectionPoolFactory
      .connect(connectToThisAccount)
      .createPoolETH(
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
  const collectionPoolETHContractReceipt: ContractReceipt =
    await collectionPoolETHContractTx.wait();
  const newPoolEvent = collectionPoolETHContractReceipt.events?.find(
    (event) => event.event === "NewPool"
  );
  const newPoolAddress = newPoolEvent?.args?.poolAddress;
  // Const collectionPoolETH = collectionPoolETHContractTx

  return {
    collectionPoolETHContractTx,
    collectionPoolETHContractReceipt,
    newPoolEvent,
    newPoolAddress,
  };
}
