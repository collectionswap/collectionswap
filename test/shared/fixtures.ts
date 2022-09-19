import { ethers } from "hardhat";

import { getSigners } from "./signers";

export async function collectionswapFixture() {
  const { collection } = await getSigners();

  const { exponentialCurve, lsSVMPairFactory } = await lsSVMFixture();
  const Collectionswap = await ethers.getContractFactory("Collectionswap");
  const collectionswap = await Collectionswap.connect(collection).deploy(
    lsSVMPairFactory.address
  );

  return { exponentialCurve, collectionswap };
}

export async function erc20Fixture() {
  const ERC20 = await ethers.getContractFactory("ERC20PresetMinterPauser");
  return await Promise.all(
    [...Array(3).keys()].map(async (i) => {
      const name = "ERC20" + String.fromCharCode(i + "A".charCodeAt(0));
      return await ERC20.deploy(name, name);
    })
  );
}

export async function erc721Fixture() {
  const ERC721 = await ethers.getContractFactory(
    "ERC721PresetMinterPauserAutoId"
  );
  const erc721 = await ERC721.deploy("ERC721", "ERC721", "");
  return { erc721 };
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
