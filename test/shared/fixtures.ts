import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { config, curveType, CURVE_TYPE } from "./constants";

import { getSigners } from "./signers";

export async function collectionswapFixture() {
  const { collection } = await getSigners();

  const { curve, lsSVMPairFactory } = await lsSVMFixture();
  const Collectionswap = await ethers.getContractFactory("Collectionswap");
  const collectionswap = await Collectionswap.connect(collection).deploy(
    lsSVMPairFactory.address
  );

  return { curve, collectionswap, collection };
}

export async function collectionstakerFixture() {
  const { collectionswap, collection, curve } = await collectionswapFixture();
  const Collectionstaker = await ethers.getContractFactory("Collectionstaker");
  const collectionstaker = await Collectionstaker.connect(collection).deploy(
    collectionswap.address
  );
  return { collectionswap, collectionstaker, curve, collection };
}

export async function rewardTokenFixture() {
  const RewardToken = await ethers.getContractFactory(
    "ERC20PresetMinterPauser"
  );
  return Promise.all(
    [...Array(10).keys()].map(async (_) => {
      return RewardToken.deploy("Reward Token", "RWT");
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

  // Deploy all contract types and set them allowed. Return only the desired
  // curve
  const ExponentialCurve = await ethers.getContractFactory("ExponentialCurve");
  const exponentialCurve = await ExponentialCurve.connect(sudoswap).deploy();
  await lsSVMPairFactory.setBondingCurveAllowed(exponentialCurve.address, true);

  const LinearCurve = await ethers.getContractFactory("LinearCurve");
  const linearCurve = await LinearCurve.connect(sudoswap).deploy();
  await lsSVMPairFactory.setBondingCurveAllowed(linearCurve.address, true);

  // TODO: Uncomment when sigmoid implemented
  // const SigmoidCurve = await ethers.getContractFactory("SigmoidCurve");
  // const sigmoidCurve = await SigmoidCurve.connect(sudoswap).deploy();
  // await lsSVMPairFactory.setBondingCurveAllowed(sigmoidCurve.address, true);

  const map: { [key in curveType]: any } = {
    linear: linearCurve,
    exponential: exponentialCurve,
    // TODO: Uncomment when sigmoid implemented
    // sigmoid: sigmoidCurve,
  };

  return {
    curve: map[CURVE_TYPE!],
    lsSVMPairFactory,
  };
}

function stringToBigNumber(value: string): BigNumber {
  return ethers.BigNumber.from(value);
}

/**
 * Has everything. Trim down when we have time, but convenient for deploy suite
 */
export async function everythingFixture() {
  const LSSVMPairEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairEnumerableETH"
  );
  const lssvmPairEnumerableETH = await LSSVMPairEnumerableETH.deploy();

  const LSSVMPairMissingEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableETH"
  );
  const lssvmPairMissingEnumerableETH =
    await LSSVMPairMissingEnumerableETH.deploy();

  const LSSVMPairEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairEnumerableERC20"
  );
  const lssvmPairEnumerableERC20 = await LSSVMPairEnumerableERC20.deploy();

  const LSSVMPairMissingEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableERC20"
  );
  const lssvmPairMissingEnumerableERC20 =
    await LSSVMPairMissingEnumerableERC20.deploy();
  const payoutAddress = ethers.constants.AddressZero;

  const { bigPctProtocolFee, bigPctFee, bigDelta, bigSpot, rawSpot } = config;

  const LSSVMPairFactory = await ethers.getContractFactory("LSSVMPairFactory");
  const lssvmPairFactory = await LSSVMPairFactory.deploy(
    lssvmPairEnumerableETH.address,
    lssvmPairMissingEnumerableETH.address,
    lssvmPairEnumerableERC20.address,
    lssvmPairMissingEnumerableERC20.address,
    payoutAddress,
    stringToBigNumber(bigPctProtocolFee)
  );
  // Console.log(`LSSVMPairFactory deployed to ${lssvmPairFactory.address}`)

  const [
    otherAccount0,
    otherAccount1,
    otherAccount2,
    otherAccount3,
    otherAccount4,
    otherAccount5,
  ] = await ethers.getSigners();
  // Console.log([otherAccount0.address, otherAccount1.address, otherAccount2.address, otherAccount3.address, otherAccount4.address])

  const MyERC721 = await ethers.getContractFactory("Alchemy");
  const myERC721 = await MyERC721.deploy();

  const MyERC1155 = await ethers.getContractFactory("MyERC1155");
  const myERC1155 = await MyERC1155.deploy();

  // Deploy all curve contracts and assign the desired curve to `curve`
  const LinearCurve = await ethers.getContractFactory("LinearCurve");
  const linearCurve = await LinearCurve.deploy();

  const ExponentialCurve = await ethers.getContractFactory("ExponentialCurve");
  const exponentialCurve = await ExponentialCurve.deploy();

  // TODO: Uncomment when sigmoid implemented
  // const SigmoidCurve = await ethers.getContractFactory("SigmoidCurve");
  // const sigmoidCurve = await SigmoidCurve.deploy();

  const map: { [key in curveType]: any } = {
    linear: linearCurve,
    exponential: exponentialCurve,
    // TODO: Uncomment when sigmoid implemented
    // sigmoid: sigmoidCurve,
  };
  const curve = map[CURVE_TYPE!];

  const nftContractCollection = myERC721;
  const nftContractCollection1155 = myERC1155;
  const assetRecipient = ethers.constants.AddressZero;
  const poolType = await lssvmPairEnumerableETH.poolType();

  const initialNFTIDs = [...Array(3).keys()].map((num) => num + 1234);
  await lssvmPairFactory.setBondingCurveAllowed(curve.address, true);

  const Collectionswap = await ethers.getContractFactory("Collectionswap");
  const collectionswap = await Collectionswap.deploy(lssvmPairFactory.address);
  // Console.log(`Collectionswap deployed to ${collectionswap.address}`)

  return {
    collectionswap,
    lssvmPairFactory,
    lssvmPairEnumerableETH,
    lssvmPairMissingEnumerableETH,
    lssvmPairEnumerableERC20,
    lssvmPairMissingEnumerableERC20,
    curve,
    nftContractCollection,
    assetRecipient,
    poolType,
    bigPctProtocolFee: stringToBigNumber(bigPctProtocolFee),
    delta: stringToBigNumber(bigDelta),
    fee: stringToBigNumber(bigPctFee),
    spotPrice: stringToBigNumber(bigSpot),
    initialNFTIDs,
    rawSpot,
    otherAccount0,
    otherAccount1,
    otherAccount2,
    otherAccount3,
    otherAccount4,
    otherAccount5,
    nftContractCollection1155,
  };
}
