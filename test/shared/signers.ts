import { ethers } from "hardhat";

export async function getSigners() {
  const [
    owner,
    sudoswap,
    collection,
    protocol,
    user,
    user1,
    user2,
    hypotheticalProtocolOwner,
    hypotheticalProtocolFactory,
  ] = await ethers.getSigners();
  return {
    owner,
    sudoswap,
    collection,
    protocol,
    user,
    user1,
    user2,
    hypotheticalProtocolOwner,
    hypotheticalProtocolFactory,
  };
}
