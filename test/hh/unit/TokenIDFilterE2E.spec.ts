/**
 * Testing approach for verifying fummpel library == TokenIDFilter contract:
 *
 * Let us refer to fummpel as JS and TokenIDFilter as SC.
 *
 * We need to show that the set of accepted inputs (where inputs consist of the
 * true set of accepted IDs and the list of IDs to verify) for JS and SC are
 * equal
 *
 * The classic approach to show this is to show that JS accepts => SC accepts
 * and JS rejects => SC rejects. However, we cannot even generate an input for
 * SC if JS rejects. Doing so is a problem no simpler than generating a hash
 * collision for the 256bit merkle tree root. Thus, we do not need to test the
 * second direction.
 *
 * This leaves us to test JS accepts => SC accepts, which is what this file sets
 * out to do empirically.
 */
import { TokenIDs as TokenIds } from "filter_code";
import { ethers, expect } from "hardhat";

import { everythingFixture, nftFixture } from "../shared/fixtures";
import { mintAndApproveNfts, pickRandomElements } from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type { Test721Enumerable } from "../../../typechain-types";

const MAX_ACCEPTED_TOKEN_IDS = 4;

describe("Testing filter_code library is consistent with TokenIdFilter contract", function () {
  it("Should be able to create pool with subset of allowed ids as initial ids", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let numInitialIds = 0;
        numInitialIds <= filterSize;
        numInitialIds++
      ) {
        await createFilteredPool(filterSize, numInitialIds);
      }
    }
  });

  it("Should acceptTokenID for accepted IDs which are in pool", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let numInitialIds = 0;
        numInitialIds <= filterSize;
        numInitialIds++
      ) {
        const { collectionPoolETH, acceptedTokenIds, tokenIdFilter } =
          await createFilteredPool(filterSize, numInitialIds);

        for (const tokenId of acceptedTokenIds) {
          const { proof } = tokenIdFilter.proof([BigInt(tokenId)]);
          expect(await collectionPoolETH.acceptsTokenID(tokenId, proof)).to.be
            .true;
        }
      }
    }
  });

  it("Should acceptTokenIDs for accepted IDs which are in pool", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let numInitialIds = 0;
        numInitialIds <= filterSize;
        numInitialIds++
      ) {
        const { collectionPoolETH, tokenIdFilter } = await createFilteredPool(
          filterSize,
          numInitialIds
        );

        for (let subsetSize = 0; subsetSize <= filterSize; subsetSize++) {
          const subset = pickRandomElements(
            tokenIdFilter.tokens(),
            subsetSize
          ).map(BigInt);
          const { proof, proofFlags } = tokenIdFilter.proof(subset);
          expect(
            await collectionPoolETH.acceptsTokenIDs(
              tokenIdFilter.sort(subset),
              proof,
              proofFlags
            )
          ).to.be.true;
        }
      }
    }
  });

  it("Should allow swapNFTsForToken for accepted IDs (i.e. accepts ids which are not in pool)", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let initialHeldIds = 0;
        initialHeldIds < filterSize;
        initialHeldIds++
      ) {
        for (
          let sellQty = 1;
          sellQty <= filterSize - initialHeldIds;
          sellQty++
        ) {
          const {
            collectionPoolETH: pool,
            acceptedTokenIds,
            tokenIdFilter,
            owner,
            nft,
          } = await createFilteredPool(filterSize, initialHeldIds);

          const poolIds = (await pool.getAllHeldIds()).map((bn) =>
            bn.toString()
          );
          const otherAcceptedIds = acceptedTokenIds.filter((tokenId) => {
            return !poolIds.includes(tokenId);
          });

          const idsToSell = pickRandomElements(otherAcceptedIds, sellQty).map(
            BigInt
          );
          const { proof, proofFlags } = tokenIdFilter.proof(idsToSell);
          const quote = (await pool.getSellNFTQuote(sellQty))[3];
          await nft.connect(owner).setApprovalForAll(pool.address, true);
          await pool.connect(owner).swapNFTsForToken(
            {
              ids: tokenIdFilter.sort(idsToSell),
              proof,
              proofFlags,
            },
            quote,
            owner.address,
            false,
            owner.address
          );

          let success = true;
          const poolHeldIds = new Set<string>(
            (await pool.getAllHeldIds()).map((bn) => bn.toString())
          );
          for (const tokenId of idsToSell) {
            success = success && poolHeldIds.has(tokenId.toString());
          }
        }
      }
    }
  });

  it("Should revert upon setTokenIDFilter if not empty", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let initialHeldIds = 1;
        initialHeldIds < filterSize;
        initialHeldIds++
      ) {
        const { collectionPoolETH: pool } = await createFilteredPool(
          filterSize,
          initialHeldIds
        );

        const newFilter = new TokenIds([0n]);
        expect(
          pool.setTokenIDFilter(newFilter.root(), newFilter.encode())
        ).to.be.revertedWith("pool not empty");
      }
    }
  });

  it("Should emit event upon setTokenIDFilter", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let newFilterSize = 1;
        newFilterSize <= MAX_ACCEPTED_TOKEN_IDS;
        newFilterSize++
      ) {
        const { collectionPoolETH: pool, nft } = await createFilteredPool(
          filterSize,
          0
        );

        const { tokenIdFilter: newFilter } = await createFilteredPool(
          newFilterSize,
          0,
          nft
        );
        expect(pool.setTokenIDFilter(newFilter.root(), newFilter.encode()))
          .to.emit(pool, "AcceptsTokenIDs")
          .withArgs(await pool.nft(), newFilter.root(), newFilter.encode());
      }
    }
  }).timeout(100000);

  it("Should acceptTokenID for accepted IDs which are in the pool after setTokenIDFilter", async function () {
    for (
      let newFilterSize = 1;
      newFilterSize <= MAX_ACCEPTED_TOKEN_IDS;
      newFilterSize++
    ) {
      const { collectionPoolETH, nft } = await createFilteredPool(1, 0);

      const { acceptedTokenIds, tokenIdFilter: newFilter } =
        await createFilteredPool(newFilterSize, 0, nft);

      await collectionPoolETH.setTokenIDFilter(
        newFilter.root(),
        newFilter.encode()
      );

      for (const tokenId of acceptedTokenIds) {
        const { proof } = newFilter.proof([BigInt(tokenId)]);
        expect(await collectionPoolETH.acceptsTokenID(tokenId, proof)).to.be
          .true;
      }
    }
  });

  it("Should acceptTokenIDs for accepted IDs which are in the pool after setTokenIDFilter", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let newFilterSize = 1;
        newFilterSize <= MAX_ACCEPTED_TOKEN_IDS;
        newFilterSize++
      ) {
        const { collectionPoolETH, nft } = await createFilteredPool(
          filterSize,
          0
        );

        const { tokenIdFilter: newFilter } = await createFilteredPool(
          newFilterSize,
          0,
          nft
        );

        await collectionPoolETH.setTokenIDFilter(
          newFilter.root(),
          newFilter.encode()
        );

        for (let subsetSize = 0; subsetSize <= newFilterSize; subsetSize++) {
          const subset = pickRandomElements(newFilter.tokens(), subsetSize).map(
            BigInt
          );
          const { proof, proofFlags } = newFilter.proof(subset);
          expect(
            await collectionPoolETH.acceptsTokenIDs(
              newFilter.sort(subset),
              proof,
              proofFlags
            )
          ).to.be.true;
        }
      }
    }
  });

  it("Should allow swapNFTsForToken for accepted IDs which are not in the pool after setTokenIDFilter", async function () {
    for (
      let filterSize = 1;
      filterSize <= MAX_ACCEPTED_TOKEN_IDS;
      filterSize++
    ) {
      for (
        let initialHeldIds = 0;
        initialHeldIds < filterSize;
        initialHeldIds++
      ) {
        for (
          let sellQty = 1;
          sellQty <= filterSize - initialHeldIds;
          sellQty++
        ) {
          const { collectionPoolETH: pool, nft } = await createFilteredPool(
            filterSize,
            0
          );

          const { tokenIdFilter: newFilter, owner } = await createFilteredPool(
            filterSize,
            0,
            nft
          );
          await nft.connect(owner).setApprovalForAll(pool.address, true);

          // Transfer initial NFTs into pool
          await pool.setTokenIDFilter(newFilter.root(), newFilter.encode());
          const initialIds = pickRandomElements(
            newFilter.tokens(),
            initialHeldIds
          );
          for (const id of initialIds) {
            const { proof, proofFlags } = newFilter.proof([id]);
            await pool.connect(owner).swapNFTsForToken(
              {
                ids: newFilter.sort([id]),
                proof,
                proofFlags,
              },
              0,
              owner.address,
              false,
              owner.address
            );
          }

          const idsToSell = pickRandomElements(
            newFilter.tokens().filter((id) => !initialIds.includes(id)),
            sellQty
          ).map(BigInt);
          const { proof, proofFlags } = newFilter.proof(idsToSell);
          const quote = (await pool.getSellNFTQuote(1))[3];

          await pool.connect(owner).swapNFTsForToken(
            {
              ids: newFilter.sort(idsToSell),
              proof,
              proofFlags,
            },
            quote,
            owner.address,
            false,
            owner.address
          );

          let success = true;
          const poolHeldIds = new Set<string>(
            (await pool.getAllHeldIds()).map((bn) => bn.toString())
          );
          for (const tokenId of idsToSell) {
            success = success && poolHeldIds.has(tokenId.toString());
          }
        }
      }
    }
  });
});

/**
 * Create a pool which accepts `numAccepted` tokenIds and starts with `numInitial`
 * of those tokenIds in the pool
 *
 * @returns The nft, owner, and pool addresses. Also returns an array of accepted
 * tokenIds and the tokenIdFilter
 */
async function createFilteredPool(
  numAccepted: number,
  numInitial: number,
  nft?: Test721Enumerable
) {
  // Get a factory and some default pool parameters
  const { collectionPoolFactory, ethPoolParams } = await everythingFixture();
  if (nft === undefined) {
    nft = (await nftFixture()).nft;
  }

  const { owner } = await getSigners();

  const acceptedTokenIds = await mintAndApproveNfts(
    nft,
    owner,
    collectionPoolFactory.address,
    numAccepted
  );

  const initialPoolTokenIds = pickRandomElements(
    acceptedTokenIds,
    numInitial
  ).map(BigInt);

  const tokenIdFilter = new TokenIds(acceptedTokenIds.map(BigInt));
  const merkleRoot = tokenIdFilter.root();
  const encodedTokenIDs = tokenIdFilter.encode();
  const { proof: initialProof, proofFlags: initialProofFlags } =
    tokenIdFilter.proof(initialPoolTokenIds);

  // TokenIds need to be sorted before any legitimate addition to the pool
  const initialNFTIDs = tokenIdFilter.sort(initialPoolTokenIds);

  // Create the pool with filter parameters
  const receipt = await (
    await collectionPoolFactory.createPoolETHFiltered(
      {
        ...ethPoolParams,
        nft: nft.address,
        initialNFTIDs,
      },
      {
        merkleRoot,
        encodedTokenIDs,
        initialProof,
        initialProofFlags,
      },
      {
        value: ethers.BigNumber.from(`${10e18}`),
        gasLimit: 10000000,
      }
    )
  ).wait();

  const poolAddress: string = receipt.events
    ?.filter((event) => event.event === "NewPool")
    .map((event) => event.args?.poolAddress)[0];

  const collectionPoolETH = await ethers.getContractAt(
    "CollectionPoolETH",
    poolAddress
  );

  return { collectionPoolETH, owner, nft, acceptedTokenIds, tokenIdFilter };
}
