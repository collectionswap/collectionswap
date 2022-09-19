import { ethers } from "hardhat";

export async function getSigners() {
  const [owner, sudoswap, collection, protocol, user, user1] =
    await ethers.getSigners();
  return { owner, sudoswap, collection, protocol, user, user1 };
}
