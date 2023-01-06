/* eslint-disable new-cap */
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  changesEtherBalancesFuzzy,
  changesEtherBalancesFuzzyMultipleTransactions,
} from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  PackageFaucet,
  ERC20Mintable,
  ERC721Mintable,
  ETHFaucet,
} from "../../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const NOT_OWNER_MSG = "Ownable: caller is not the owner";

describe("Testing testnet competition faucets", function () {
  let faucet: PackageFaucet;
  let erc20Faucet: ERC20Mintable;
  let erc721Faucet: ERC721Mintable;
  let ethFaucet: ETHFaucet;
  let user: SignerWithAddress;
  let deployer: SignerWithAddress;

  beforeEach(async function () {
    ({ faucet, erc20Faucet, erc721Faucet, ethFaucet, deployer } =
      await loadFixture(faucetFixture));

    ({ user } = await getSigners());
  });

  it("Should dispense for allowed user", async function () {
    const oldERC20Balance = await erc20Faucet.balanceOf(user.address);
    const oldERC721Balance = await erc721Faucet.balanceOf(user.address);

    const tx = await faucet.connect(user).freeMint(user.address);

    const newERC20Balance = await erc20Faucet.balanceOf(user.address);
    const newERC721Balance = await erc721Faucet.balanceOf(user.address);

    expect(
      // Account for gas fees
      await changesEtherBalancesFuzzy(
        tx,
        [user.address],
        [await faucet.ETH_MINT_AMOUNT()]
      )
    ).to.be.true;
    expect(newERC20Balance).to.be.equal(
      oldERC20Balance.add(await faucet.ERC20_MINT_AMOUNT())
    );
    expect(newERC721Balance).to.be.equal(
      oldERC721Balance.add(await faucet.ERC721_MINT_AMOUNT())
    );
  });

  it("Should dispense to specified target for allowed user", async function () {
    const { user1 } = await getSigners();
    const oldERC20Balance = await erc20Faucet.balanceOf(user1.address);
    const oldERC721Balance = await erc721Faucet.balanceOf(user1.address);

    const tx = await faucet.connect(user).freeMint(user1.address);

    const newERC20Balance = await erc20Faucet.balanceOf(user1.address);
    const newERC721Balance = await erc721Faucet.balanceOf(user1.address);

    expect(
      // Account for gas fees
      await changesEtherBalancesFuzzy(
        tx,
        [user1.address],
        [await faucet.ETH_MINT_AMOUNT()]
      )
    ).to.be.true;
    expect(newERC20Balance).to.be.equal(
      oldERC20Balance.add(await faucet.ERC20_MINT_AMOUNT())
    );
    expect(newERC721Balance).to.be.equal(
      oldERC721Balance.add(await faucet.ERC721_MINT_AMOUNT())
    );
  });

  it("Should revert upon being called by a disallowed user", async function () {
    const { user1 } = await getSigners();

    await expect(
      faucet.connect(user1).freeMint(user1.address)
    ).to.be.revertedWith("Not an approved faucet user");
  });

  it("Should revert during cooldown", async function () {
    await faucet.connect(user).freeMint(user.address);

    await expect(
      faucet.connect(user).freeMint(user.address)
    ).to.be.revertedWith("cooldown in effect");
  });

  it("Should dispense again after cooldown", async function () {
    const oldERC20Balance = await erc20Faucet.balanceOf(user.address);
    const oldERC721Balance = await erc721Faucet.balanceOf(user.address);

    const tx1 = await faucet.connect(user).freeMint(user.address);
    await time.increase(await faucet.COOLDOWN());
    const tx2 = await faucet.connect(user).freeMint(user.address);

    const newERC20Balance = await erc20Faucet.balanceOf(user.address);
    const newERC721Balance = await erc721Faucet.balanceOf(user.address);

    expect(
      // Account for gas fees
      await changesEtherBalancesFuzzyMultipleTransactions(
        [tx1, tx2],
        [user.address],
        [(await faucet.ETH_MINT_AMOUNT()).mul(2)]
      )
    ).to.be.true;
    expect(newERC20Balance).to.be.equal(
      oldERC20Balance.add((await faucet.ERC20_MINT_AMOUNT()).mul(2))
    );
    expect(newERC721Balance).to.be.equal(
      oldERC721Balance.add((await faucet.ERC721_MINT_AMOUNT()).mul(2))
    );
  });

  it("Should allow deployer to add allowed users", async function () {
    const { user1 } = await getSigners();
    await faucet.connect(deployer).approveUser([user1.address]);

    const oldERC20Balance = await erc20Faucet.balanceOf(user1.address);
    const oldERC721Balance = await erc721Faucet.balanceOf(user1.address);

    const tx = await faucet.connect(user1).freeMint(user1.address);

    const newERC20Balance = await erc20Faucet.balanceOf(user1.address);
    const newERC721Balance = await erc721Faucet.balanceOf(user1.address);

    expect(
      // Account for gas fees
      await changesEtherBalancesFuzzy(
        tx,
        [user1.address],
        [await faucet.ETH_MINT_AMOUNT()]
      )
    ).to.be.true;
    expect(newERC20Balance).to.be.equal(
      oldERC20Balance.add(await faucet.ERC20_MINT_AMOUNT())
    );
    expect(newERC721Balance).to.be.equal(
      oldERC721Balance.add(await faucet.ERC721_MINT_AMOUNT())
    );
  });

  it("Should revert if non-deployer tries to add allowed users", async function () {
    await expect(
      faucet.connect(user).approveUser([user.address])
    ).to.be.revertedWith(NOT_OWNER_MSG);
  });

  it("Should accept ETH recharges from arbitrary addresses", async function () {
    const value = ethers.utils.parseEther("1");
    await expect(faucet.connect(user).rechargeETH({ value }))
      .to.emit(faucet, "receivedETH")
      .withArgs(value);
  });

  it("Should revert if anyone but the main faucet calls any of the lower level faucets", async function () {
    for (const subFaucet of [erc20Faucet, erc721Faucet, ethFaucet]) {
      for (const contractCaller of [deployer, user]) {
        await expect(
          subFaucet.connect(contractCaller).freeMint(contractCaller.address, 1)
        ).to.be.revertedWith(NOT_OWNER_MSG);
      }
    }
  });
});

async function faucetFixture() {
  const { owner: deployer, user } = await getSigners();
  const faucetFactory = await ethers.getContractFactory("PackageFaucet");
  const startAmount = ethers.utils.parseEther("1.0");
  const faucet = await faucetFactory.deploy(
    "erc20NameTest",
    "erc20SymbolTest",
    "erc721NameTest",
    "erc721SymbolTest",
    "www.testURI.com",
    [user.address],
    { value: startAmount }
  );
  await faucet.deployed();

  const erc20Faucet = await ethers.getContractAt(
    "ERC20Mintable",
    await faucet.erc20Faucet()
  );
  const erc721Faucet = await ethers.getContractAt(
    "ERC721Mintable",
    await faucet.erc721Faucet()
  );
  const ethFaucet = await ethers.getContractAt(
    "ETHFaucet",
    await faucet.ethFaucet()
  );

  // // @ts-ignore
  // const tx = await user.sendTransaction({
  //   to: faucet.address,
  //   value: startAmount,
  // });

  // const receipt = await tx.wait();
  // await expect(receipt).to.emit(faucet, "receivedETH").withArgs(startAmount);

  return { faucet, erc20Faucet, erc721Faucet, ethFaucet, deployer };
}
