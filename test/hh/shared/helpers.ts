import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import type {
  Collectionswap,
  ICurve,
  Collectionstaker,
  IERC20,
  IERC721,
  RewardPoolETH,
  ERC721PresetMinterPauserAutoId,
  IValidator,
} from "../../../typechain-types";
import type { BigNumberish } from "ethers";

export async function mintNfts(
  nft: ERC721PresetMinterPauserAutoId,
  to: string,
  n = 1
): Promise<string[]> {
  return Promise.all(
    new Array(n).fill(0).map(async () => {
      const response = await nft.mint(to);
      const receipt = await response.wait();
      return receipt.events![0]!.args!.tokenId;
    })
  );
}

interface Params {
  user: string;
  nft: IERC721;
  bondingCurve: ICurve;
  delta: BigNumberish;
  fee: BigNumberish;
}

export async function createIncentiveEth(
  collectionstaker: Collectionstaker,
  {
    user,
    validator,
    nft,
    bondingCurve,
    delta,
    fee,
    rewardTokens,
    rewards,
    startTime,
    endTime,
  }: Params & {
    validator: IValidator;
    rewardTokens: IERC20[];
    rewards: BigNumberish[];
    startTime: BigNumberish;
    endTime: BigNumberish;
  }
): Promise<{ dBalance: BigNumberish; rewardPool: RewardPoolETH }> {
  let dBalance = BigNumber.from(0);
  for (let i = 0; i < rewardTokens.length; i++) {
    const response = await rewardTokens[i].approve(
      collectionstaker.address,
      rewards[i]
    );
    const receipt = await response.wait();
    dBalance = dBalance.add(
      receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
    );
  }

  const response = await collectionstaker.createIncentiveETH(
    validator.address,
    nft.address,
    bondingCurve.address,
    { spotPrice: 0, delta, props: [], state: [] },
    fee,
    rewardTokens.map((rewardToken) => rewardToken.address),
    rewards,
    startTime,
    endTime
  );
  const receipt = await response.wait();
  dBalance = dBalance.add(
    receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
  );

  const events = receipt.events!;
  const { poolAddress } = events.at(-1)!.args!;

  const rewardPool = await ethers.getContractAt("RewardPoolETH", poolAddress);
  return {
    dBalance,
    rewardPool,
  };
}

export async function createPairEth(
  collectionswap: Collectionswap,
  {
    user,
    nft,
    bondingCurve,
    delta,
    fee,
    spotPrice,
    props,
    state,
    nftTokenIds,
    value,
  }: Params & {
    spotPrice: BigNumberish;
    nftTokenIds: BigNumberish[];
    value: BigNumberish;
    props: any;
    state: any;
  }
): Promise<{
  dBalance: BigNumberish;
  pairAddress: string;
  lpTokenId: BigNumberish;
}> {
  let response = await nft.setApprovalForAll(collectionswap.address, true);
  let receipt = await response.wait();
  let dBalance = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice);

  response = await collectionswap.createDirectPairETH(
    user,
    nft.address,
    bondingCurve.address,
    delta,
    fee,
    spotPrice,
    props,
    state,
    nftTokenIds,
    { value }
  );
  receipt = await response.wait();
  dBalance = dBalance.add(
    receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
  );
  const events = receipt.events!;
  return {
    dBalance,
    pairAddress: events[1].args!.poolAddress,
    lpTokenId: events.at(-2)!.args!.tokenId,
  };
}
