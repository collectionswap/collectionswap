import { ethers } from "hardhat";

import { getSigners } from "./signers";

export async function collectionswapFixture() {
  const { collection } = await getSigners();

  const { exponentialCurve, lsSVMPairFactory } = await lsSVMFixture();
  const Collectionswap = await ethers.getContractFactory("Collectionswap");
  const collectionswap = await Collectionswap.connect(collection).deploy(
    lsSVMPairFactory.address
  );

  return { exponentialCurve, collectionswap, collection };
}

export async function collectionstakerFixture() {
  const { collectionswap, collection, exponentialCurve } =
    await collectionswapFixture();
  const Collectionstaker = await ethers.getContractFactory("Collectionstaker");
  const collectionstaker = await Collectionstaker.connect(collection).deploy(
    collectionswap.address
  );
  return { collectionswap, collectionstaker, exponentialCurve, collection };
}

export async function rewardTokenFixture() {
  const RewardToken = await ethers.getContractFactory(
    "ERC20PresetMinterPauser"
  );
  return await Promise.all(
    [...Array(10).keys()].map(async (i) => {
      return await RewardToken.deploy("Reward Token", "RWT");
    })
  );
}

export async function nftFixture() {
  const NFT = await ethers.getContractFactory("ERC721PresetMinterPauserAutoId");
  const nft = await NFT.deploy("NFT", "NFT", "");
  return { nft };
}

export async function lsSVMFixture() {
  const { sudoswap } = await getSigners();

  const LSSVMPairEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairEnumerableETH"
  );
  const lsSVMPairEnumerableETH = await LSSVMPairEnumerableETH.connect(
    sudoswap
  ).deploy();

  const LSSVMPairMissingEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableETH"
  );
  const lsSVMPairMissingEnumerableETH =
    await LSSVMPairMissingEnumerableETH.connect(sudoswap).deploy();

  const LSSVMPairEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairEnumerableERC20"
  );
  const lsSVMPairEnumerableERC20 = await LSSVMPairEnumerableERC20.connect(
    sudoswap
  ).deploy();

  const LSSVMPairMissingEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableERC20"
  );
  const lsSVMPairMissingEnumerableERC20 =
    await LSSVMPairMissingEnumerableERC20.connect(sudoswap).deploy();

  const protocolFeeRecipient = ethers.constants.AddressZero;
  const protocolFeeMultiplier = ethers.utils.parseEther("0.05");

  const LSSVMPairFactory = await ethers.getContractFactory("LSSVMPairFactory");
  const lsSVMPairFactory = await LSSVMPairFactory.connect(sudoswap).deploy(
    lsSVMPairEnumerableETH.address,
    lsSVMPairMissingEnumerableETH.address,
    lsSVMPairEnumerableERC20.address,
    lsSVMPairMissingEnumerableERC20.address,
    protocolFeeRecipient,
    protocolFeeMultiplier
  );

  const ExponentialCurve = await ethers.getContractFactory("ExponentialCurve");
  const exponentialCurve = await ExponentialCurve.connect(sudoswap).deploy();
  await lsSVMPairFactory.setBondingCurveAllowed(exponentialCurve.address, true);

  const LinearCurve = await ethers.getContractFactory("LinearCurve");
  const linearCurve = await LinearCurve.connect(sudoswap).deploy();
  await lsSVMPairFactory.setBondingCurveAllowed(linearCurve.address, true);

  return { exponentialCurve, lsSVMPairFactory };
}
