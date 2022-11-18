import { readFileSync } from "fs";
import * as path from "path";

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { Contract, ContractTransaction } from "ethers";

const IMPLEMENTED_CURVES = ["linear", "exponential", "sigmoid"] as const;
export type curveType = typeof IMPLEMENTED_CURVES[number];
export const CURVE_TYPE: curveType = process.env.CURVE_TYPE as curveType;
export let config = {} as any;

if (!IMPLEMENTED_CURVES.includes(CURVE_TYPE as any)) {
  console.log(
    `Run the script with CURVE_TYPE environment variable set to one of ${IMPLEMENTED_CURVES.join(
      ", "
    )}`
  );
  process.exit(-1);
}

try {
  config = JSON.parse(
    readFileSync(path.resolve(__dirname, `../config/${CURVE_TYPE}.json`), {
      encoding: "utf8",
      flag: "r",
    })
  );
} catch (err) {
  console.log(err);
}

export async function mintTokensAndApprove(
  initialNFTIDs: number[],
  myERC721: Contract,
  thisAccount: SignerWithAddress,
  lssvmPairFactory: Contract
) {
  for (const nftId of initialNFTIDs) {
    await myERC721.mint(thisAccount.address, nftId);
    await myERC721
      .connect(thisAccount)
      .approve(lssvmPairFactory.address, nftId);
    // Console.log(`owner of ${nftId} is '${await myERC721.ownerOf(nftId)}'`)
  }
}

export async function getPoolAddress(tx: ContractTransaction, showGas = false) {
  const receipt = await tx.wait();
  if (showGas) {
    console.log("gas used:", receipt.cumulativeGasUsed);
  }

  const newPoolEvent = receipt.events?.find(
    (event) => event.event === "NewPair"
  );
  const newPairAddress = newPoolEvent?.args?.poolAddress;
  const newTokenEvent = receipt.events?.find(
    (event) => event.event === "NewTokenId"
  );
  const newTokenId = newTokenEvent?.args?.tokenId;
  return { newPairAddress, newTokenId };
}
