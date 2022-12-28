import { TokenIDs as TokenIds } from "filter_code";
import { ethers, expect } from "hardhat";

import { everythingFixture, nftFixture } from "../shared/fixtures";
import {
  mintAndApproveRandomNfts,
  pickRandomElements,
} from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type { Test721Enumerable } from "../../../typechain-types";

const MAX_ACCEPTED_TOKEN_IDS = 4;
const WRONG_PROOF: any[] = [];

/**
 * @param hint An old filter whose tokenIds should be prioritized for addition to
 * the output
 */
function getBannedIds(filter: TokenIds, n: number, hint?: TokenIds): bigint[] {
  const arr = filter.tokens();
  const output = new Set<bigint>(
    hint?.tokens()?.filter((id) => !arr.includes(id)) ?? []
  );
  let nextElement = 0n;
  while (output.size < n) {
    while (arr.includes(nextElement) || output.has(nextElement)) nextElement++;
    output.add(nextElement);
  }

  return Array.from(output).slice(0, n);
}

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

  it("Should not acceptTokenID for non-accepted IDs which are in pool", async function () {
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

        const unallowedId = getBannedIds(tokenIdFilter, 1)[0];

        expect(await collectionPoolETH.acceptsTokenID(unallowedId, WRONG_PROOF))
          .to.be.false;
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

  it("Should not acceptTokenIDs for non accepted IDs which are in pool", async function () {
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

        for (let subsetSize = 1; subsetSize <= filterSize; subsetSize++) {
          const bannedIds = getBannedIds(tokenIdFilter, subsetSize);
          const allowedSubset = pickRandomElements(
            tokenIdFilter.tokens(),
            subsetSize
          ).map(BigInt);

          const spoof = tokenIdFilter.proof(allowedSubset);
          const { proof, proofFlags } = spoof;
          expect(
            await collectionPoolETH.acceptsTokenIDs(
              bannedIds,
              proof,
              proofFlags
            )
          ).to.be.false;
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
            return !poolIds.includes(tokenId.toString());
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

  it("Should not allow swapNFTsForToken for non accepted IDs", async function () {
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

          const bannedIds = getBannedIds(tokenIdFilter, sellQty);
          const spoofIds = pickRandomElements(otherAcceptedIds, sellQty).map(
            BigInt
          );
          const spoof = tokenIdFilter.proof(spoofIds);
          const { proof, proofFlags } = spoof;
          const quote = ethers.BigNumber.from(0);
          await nft.connect(owner).setApprovalForAll(pool.address, true);
          await expect(
            pool.connect(owner).swapNFTsForToken(
              {
                ids: bannedIds,
                proof,
                proofFlags,
              },
              quote,
              owner.address,
              false,
              owner.address
            )
          ).to.be.reverted;
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
        await expect(
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
        await expect(
          pool.setTokenIDFilter(newFilter.root(), newFilter.encode())
        )
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

  it("Should not acceptTokenID for non accepted IDs which are in the pool after setTokenIDFilter", async function () {
    for (
      let newFilterSize = 1;
      newFilterSize <= MAX_ACCEPTED_TOKEN_IDS;
      newFilterSize++
    ) {
      const {
        collectionPoolETH,
        nft,
        tokenIdFilter: oldFilter,
      } = await createFilteredPool(1, 0);

      const { tokenIdFilter: newFilter } = await createFilteredPool(
        newFilterSize,
        0,
        nft
      );

      await collectionPoolETH.setTokenIDFilter(
        newFilter.root(),
        newFilter.encode()
      );

      expect(
        await collectionPoolETH.acceptsTokenID(
          getBannedIds(newFilter, 1, oldFilter)[0],
          WRONG_PROOF
        )
      ).to.be.false;
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

  it("Should not acceptTokenIDs for non accepted IDs which are in the pool after setTokenIDFilter", async function () {
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
        const {
          collectionPoolETH,
          nft,
          tokenIdFilter: oldFilter,
        } = await createFilteredPool(filterSize, 0);

        const { tokenIdFilter: newFilter } = await createFilteredPool(
          newFilterSize,
          0,
          nft
        );

        await collectionPoolETH.setTokenIDFilter(
          newFilter.root(),
          newFilter.encode()
        );

        for (let subsetSize = 1; subsetSize <= newFilterSize; subsetSize++) {
          const bannedIds = getBannedIds(newFilter, subsetSize, oldFilter);
          const allowedSubset = pickRandomElements(
            newFilter.tokens(),
            subsetSize
          ).map(BigInt);

          const spoof = newFilter.proof(allowedSubset);
          const { proof, proofFlags } = spoof;
          expect(
            await collectionPoolETH.acceptsTokenIDs(
              bannedIds,
              proof,
              proofFlags
            )
          ).to.be.false;
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

  it("Should not allow swapNFTsForToken for non accepted IDs which are not in the pool after setTokenIDFilter", async function () {
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
            nft,
            tokenIdFilter: oldFilter,
          } = await createFilteredPool(filterSize, 0);

          const {
            tokenIdFilter: newFilter,
            owner,
            acceptedTokenIds,
          } = await createFilteredPool(filterSize, 0, nft);
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

          const poolIds = (await pool.getAllHeldIds()).map((bn) =>
            bn.toString()
          );
          const otherAcceptedIds = acceptedTokenIds.filter((tokenId) => {
            return !poolIds.includes(tokenId);
          });
          const bannedIds = getBannedIds(newFilter, sellQty, oldFilter);
          const spoofIds = pickRandomElements(otherAcceptedIds, sellQty).map(
            BigInt
          );
          const spoof = newFilter.proof(spoofIds);
          const { proof, proofFlags } = spoof;
          const quote = ethers.BigNumber.from(0);

          await expect(
            pool.connect(owner).swapNFTsForToken(
              {
                ids: bannedIds,
                proof,
                proofFlags,
              },
              quote,
              owner.address,
              false,
              owner.address
            )
          ).to.be.reverted;
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

  const acceptedTokenIds = await mintAndApproveRandomNfts(
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
