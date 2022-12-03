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
    royaltyRecipient0,
    royaltyRecipient1,
    royaltyRecipient2,
    royaltyRecipient3,
    royaltyRecipient4,
    royaltyRecipient5,
    royaltyRecipientOverride,
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
    royaltyRecipient0,
    royaltyRecipient1,
    royaltyRecipient2,
    royaltyRecipient3,
    royaltyRecipient4,
    royaltyRecipient5,
    royaltyRecipientOverride,
  };
}
