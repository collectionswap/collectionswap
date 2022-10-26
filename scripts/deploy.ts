import { ethers } from "hardhat";

import type { BigNumber, ContractTransaction } from "ethers";

function convertToBigNumber(value: number): BigNumber {
  return ethers.BigNumber.from(`${value * 1e18}`);
}

async function getPoolAddress(tx: ContractTransaction) {
  const receipt = await tx.wait();
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

async function main() {
  // Const currentTimestampInSeconds = Math.round(Date.now() / 1000)
  // const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60
  // const unlockTime = currentTimestampInSeconds + ONE_YEAR_IN_SECS

  // const lockedAmount = ethers.utils.parseEther('1')

  // const Lock = await ethers.getContractFactory('Lock')
  // const lock = await Lock.deploy(unlockTime, { value: lockedAmount })

  // await lock.deployed()

  // console.log(`Lock with 1 ETH and unlock timestamp ${unlockTime} deployed to ${lock.address}`)

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

  const rawPctProtocolFee = 0.005;
  const rawPctFee = 0.075;
  const rawPctDelta = 0.5;
  const rawSpot = 100;

  const protocolFeeMultiplier = convertToBigNumber(rawPctProtocolFee);
  const LSSVMPairFactory = await ethers.getContractFactory("LSSVMPairFactory");
  const lssvmPairFactory = await LSSVMPairFactory.deploy(
    lssvmPairEnumerableETH.address,
    lssvmPairMissingEnumerableETH.address,
    lssvmPairEnumerableERC20.address,
    lssvmPairMissingEnumerableERC20.address,
    payoutAddress,
    protocolFeeMultiplier
  );
  console.log(`LSSVMPairFactory deployed to ${lssvmPairFactory.address}`);

  const [owner, otherAccount, otherAccount2, otherAccount3, otherAccount4] =
    await ethers.getSigners();
  console.log([
    owner.address,
    otherAccount.address,
    otherAccount2.address,
    otherAccount3.address,
    otherAccount4.address,
  ]);

  const MyERC721 = await ethers.getContractFactory("Test721Enumerable");
  const myERC721 = await MyERC721.deploy();
  const nftTokenId = 999;
  const nftTokenId2 = 1000;
  const nftTokenId3 = 1001;

  // Console.log(`owner.address is ${owner.address}`)
  // console.log(`otherAccount.address is ${otherAccount.address}`)
  // console.log(`otherAccount2.address is ${otherAccount2.address}`)

  const Curve = await ethers.getContractFactory("ExponentialCurve");
  const curve = await Curve.deploy();

  const delta = convertToBigNumber(rawPctDelta + 1);
  const fee = convertToBigNumber(rawPctFee);
  const spotPrice = convertToBigNumber(rawSpot);

  const initialNFTIDs = [nftTokenId, nftTokenId2, nftTokenId3];
  await lssvmPairFactory.setBondingCurveAllowed(curve.address, true);
  // Console.log(1)
  // for each nft id, approve the factory to mint the nft

  // https://github.com/ethers-io/ethers.js/issues/1007
  // https://ethereum.stackexchange.com/questions/4086/how-are-enums-converted-to-uint

  const Collectionswap = await ethers.getContractFactory("Collectionswap");
  const collectionswap = await Collectionswap.deploy(lssvmPairFactory.address);
  console.log(`Collectionswap deployed to ${collectionswap.address}`);

  // Const theseAccounts = [otherAccount, otherAccount2]
  const theseAccountsList = [
    [otherAccount, otherAccount, otherAccount],
    [otherAccount2, otherAccount2, otherAccount3],
    [otherAccount3, otherAccount4, otherAccount4],
  ];

  const listOfListOfNFTIDs = [initialNFTIDs, [23, 24, 25], [88, 89, 90]];
  //   For (const thisAccount of theseAccounts) {
  let myIdx = 0;
  for (const theseAccounts of theseAccountsList) {
    const [thisAccount, ultimateDestAccount] = theseAccounts;

    console.log("______________________________________________________");
    console.log(
      "thisAccount is " +
        thisAccount.address +
        " ultimateDestAccount is " +
        ultimateDestAccount.address
    );

    // Const myIdx = theseAccounts.indexOf(thisAccount)
    // console.log('myIdx is ' + myIdx)
    const thisListOfNFTIDs = listOfListOfNFTIDs[myIdx];

    for (const nftId of thisListOfNFTIDs) {
      await myERC721.mint(thisAccount.address, nftId);
      await myERC721
        .connect(thisAccount)
        .approve(lssvmPairFactory.address, nftId);
      console.log(`owner of ${nftId} is '${await myERC721.ownerOf(nftId)}'`);
    }

    console.log(
      `user balance is ${await ethers.provider.getBalance(thisAccount.address)}`
    );

    await myERC721
      .connect(thisAccount)
      .setApprovalForAll(collectionswap.address, true);
    // Await myERC721.connect(thisAccount).setApprovalForAll(lssvmPairFactory.address, true)

    console.log(
      await myERC721
        .connect(thisAccount)
        .isApprovedForAll(thisAccount.address, collectionswap.address)
    );
    console.log(
      await myERC721
        .connect(thisAccount)
        .isApprovedForAll(thisAccount.address, lssvmPairFactory.address)
    );

    const newPair = await collectionswap
      .connect(thisAccount)
      .createDirectPairETH(
        myERC721.address,
        curve.address,
        delta,
        fee,
        spotPrice,
        thisListOfNFTIDs,
        {
          value: ethers.BigNumber.from(`${1.2e18}`),
          gasLimit: 1500000,
        }
      );

    const { newPairAddress, newTokenId } = await getPoolAddress(newPair);

    console.log(`new LP token minted ${newTokenId}`);

    for (const nftId of thisListOfNFTIDs) {
      console.log(`owner of ${nftId} is '${await myERC721.ownerOf(nftId)}'`);
    }

    console.log(
      `user balance is ${await ethers.provider.getBalance(thisAccount.address)}`
    );
    console.log(
      `collectionswap balance is ${await ethers.provider.getBalance(
        collectionswap.address
      )}`
    );
    console.log(
      `pool balance is ${await ethers.provider.getBalance(newPairAddress)}`
    );

    console.log(
      `is approved to operate on pool ${await collectionswap.isApprovedToOperateOnPool(
        thisAccount.address,
        newTokenId
      )}`
    );
    console.log(
      `is approved to operate on pool ${await collectionswap.isApprovedToOperateOnPool(
        thisAccount.address,
        newTokenId
      )}`
    );
    console.log(
      `is approved to operate on pool ${await collectionswap.isApprovedToOperateOnPool(
        thisAccount.address,
        newTokenId
      )}`
    );

    // Await (collectionswap.connect(owner).destroyDirectPairETH(newPairAddress))
    const totalCollectionTokensOwned = await collectionswap.balanceOf(
      thisAccount.address
    );

    for (let j = 0; j < totalCollectionTokensOwned.toNumber(); j++) {
      console.log(
        `tokenOfOwnerByIndex ${await collectionswap.tokenOfOwnerByIndex(
          thisAccount.address,
          j
        )}`
      );
    }

    // Transfer to ultimate dest
    await collectionswap
      .connect(thisAccount)
      .transferFrom(
        thisAccount.address,
        ultimateDestAccount.address,
        newTokenId
      );

    await myERC721
      .connect(ultimateDestAccount)
      .setApprovalForAll(collectionswap.address, true);

    console.log(
      `isPoolAlive ${await collectionswap.isPoolAlive(newPairAddress)}`
    );
    console.log(
      `viewPoolParams ${await collectionswap.viewPoolParams(newTokenId)}`
    );

    const MAX_I = 1;
    // Const MAX_I = 3
    for (let i = 0; i < MAX_I; i++) {
      console.log(i);
      await collectionswap
        .connect(ultimateDestAccount)
        .useLPTokenToDestroyDirectPairETH(newTokenId, {
          gasLimit: 2000000,
        });
    }

    console.log(
      `isPoolAlive ${await collectionswap.isPoolAlive(newPairAddress)}`
    );

    for (const nftId of thisListOfNFTIDs) {
      console.log(`owner of ${nftId} is '${await myERC721.ownerOf(nftId)}'`);
    }

    console.log(
      `user balance is ${await ethers.provider.getBalance(thisAccount.address)}`
    );
    console.log(
      `dest user balance is ${await ethers.provider.getBalance(
        ultimateDestAccount.address
      )}`
    );
    console.log(
      `collectionswap balance is ${await ethers.provider.getBalance(
        collectionswap.address
      )}`
    );
    console.log(
      `pool balance is ${await ethers.provider.getBalance(newPairAddress)}`
    );

    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
    myIdx++;
  }

  // For (thisAccount in [otherAccount, otherAccount2]) {
  // }

  return {
    lssvmPairFactory,
    lssvmPairEnumerableETH,
    lssvmPairMissingEnumerableETH,
    lssvmPairEnumerableERC20,
    lssvmPairMissingEnumerableERC20,
    myERC721,
    nftTokenId,
    delta,
    fee,
    spotPrice,
    rawPctDelta,
    rawPctFee,
    rawPctProtocolFee,
    rawSpot,
  };
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
