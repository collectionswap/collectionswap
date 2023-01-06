import { ethers } from "hardhat";

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export interface Signers {
  owner: SignerWithAddress;

  /** The deployer of Collection contracts */
  collectionDeployer: SignerWithAddress;
  collection: SignerWithAddress;

  protocol: SignerWithAddress;

  /** The user buying (selling) nfts from (to) the pool **/
  user: SignerWithAddress;
  user1: SignerWithAddress;
  user2: SignerWithAddress;

  hypotheticalProtocolOwner: SignerWithAddress;
  hypotheticalProtocolFactory: SignerWithAddress;

  royaltyRecipient0: SignerWithAddress;
  royaltyRecipient1: SignerWithAddress;
  royaltyRecipient2: SignerWithAddress;
  royaltyRecipient3: SignerWithAddress;
  royaltyRecipient4: SignerWithAddress;
  royaltyRecipient5: SignerWithAddress;
  royaltyRecipientFallback: SignerWithAddress;

  /** The owner of the pool */
  poolOwner: SignerWithAddress;
}

export async function getSigners(): Promise<Signers> {
  const [
    owner,
    collectionDeployer,
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
    royaltyRecipientFallback,
    poolOwner,
  ] = await ethers.getSigners();
  return {
    owner,
    collectionDeployer,
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
    royaltyRecipientFallback,
    poolOwner,
  };
}
