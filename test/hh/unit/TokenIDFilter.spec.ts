import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { expect } from "chai";
import { ethers } from "hardhat";

const { concat, hexlify, hexZeroPad, keccak256 } = ethers.utils;

// 256-bit token ID
const token = id => hexZeroPad(hexlify(id), 32);

// leave nodes are double hashed
const hash = data => keccak256(keccak256(data));

describe("TokenIDFilter", function () {
  const { BigNumber } = ethers;

  let collection, data, owner, TokenIDFilterMock, tokenIDFilterMock;

  beforeEach(async function () {
    [ owner ] = await ethers.getSigners();
    collection = owner.address;
    data = hash(owner.address);

    TokenIDFilterMock = await ethers.getContractFactory("TokenIDFilterMock");
    tokenIDFilterMock = await TokenIDFilterMock.connect(owner).deploy();
  });

  describe("Manually calculated filters / proofs", function () {
    it("should work for 1 item", async function () {
      let merkleRoot = hash(token(1));

      await tokenIDFilterMock.setTokenIDFilter(collection, merkleRoot, data);

      let accepted = await tokenIDFilterMock.acceptsTokenID(token(1), []);

      expect(await tokenIDFilterMock.acceptsTokenID(token(1), []))
        .to.equal(true);
      expect(await tokenIDFilterMock.acceptsTokenID(token(2), []))
        .to.equal(false);

      expect(await tokenIDFilterMock.acceptsTokenIDs([token(1)], [], []))
        .to.equal(true);
      expect(await tokenIDFilterMock.acceptsTokenIDs([token(2)], [], []))
        .to.equal(false);
    });

    it("should work for 2 items", async function () {
      let hash42 = hash(token(42));
      let hash88 = hash(token(88));
      let hashes = [ hash42, hash88 ].sort();
      let merkleRoot2 = keccak256(concat(hashes));

      await tokenIDFilterMock.setTokenIDFilter(collection, merkleRoot2, data);

      expect(await tokenIDFilterMock.acceptsTokenID(token(42), [ hash(token(88)) ]))
        .to.equal(true);
      expect(await tokenIDFilterMock.acceptsTokenID(token(88), [ hash(token(42)) ]))
        .to.equal(true);
    });
  })

  describe("OpenZeppelin StandardMerkleTree proofs", async function () {
    it("should work", async function () {
      const values = [ [token(42)], [token(88)] ];
      const tree = StandardMerkleTree.of(values, ["bytes32"]);

      await tokenIDFilterMock.setTokenIDFilter(collection, tree.root, data);

      expect(await tokenIDFilterMock.acceptsTokenID(token(42), tree.getProof(0)))
        .to.equal(true);
      expect(await tokenIDFilterMock.acceptsTokenID(token(88), tree.getProof(1)))
        .to.equal(true);
    });

    it("even with large trees", async function () {
      function makeTree(seed, count, maxTokenID) {
        const tokens = [];

        for (let i = 0; i < count; i++) {
            seed = keccak256(seed);
            const token = hexZeroPad(BigNumber.from(seed).mod(maxTokenID), 32);
            tokens.push([token]);
        }

        const tree = StandardMerkleTree.of(tokens, ["bytes32"]);

        return { tokens, tree };
      }

      async function testTree(count, max) {
        let seed = hexZeroPad(hexlify(999), 32);

        const { tokens, tree } = makeTree(seed, count, max);

        await tokenIDFilterMock.setTokenIDFilter(collection, tree.root, data);

        expect(await tokenIDFilterMock.acceptsTokenID(tokens[0][0], tree.getProof(0)))
          .to.equal(true);
        expect(await tokenIDFilterMock.acceptsTokenID(tokens[1][0], tree.getProof(1)))
          .to.equal(true);
        expect(await tokenIDFilterMock.acceptsTokenID(tokens[1][0], tree.getProof(0)))
          .to.equal(false);
        expect(await tokenIDFilterMock.acceptsTokenID(tokens[count - 1][0], tree.getProof(count - 1)))
          .to.equal(true);
        expect(await tokenIDFilterMock.acceptsTokenID(tokens[count - 2][0], tree.getProof(count - 2)))
          .to.equal(true);
      }

      await testTree(500, 1000);
      await testTree(5000, 10000);
      await testTree(50000, 100000);
    });
  });

  describe("OpenZeppelin StandardMerkleTree multiproofs", async function () {
    it("one of one", async function () {
      const tokens = [ [token(42)] ];
      const tree = StandardMerkleTree.of(tokens, ["bytes32"]);
      const proof = tree.getMultiProof(tokens);

      await tokenIDFilterMock.setTokenIDFilter(collection, tree.root, data);

      expect(await tokenIDFilterMock.acceptsTokenID(token(42), tree.getProof(0)))
        .to.equal(true);

      expect(await tokenIDFilterMock.acceptsTokenID(token(1), tree.getProof(0)))
        .to.equal(false);
    });

    it("should work with large trees", async function () {
      function makeTree(seed, count, maxTokenID) {
        const tokens = [];

        for (let i = 0; i < count; i++) {
            seed = keccak256(seed);
            const token = hexZeroPad(BigNumber.from(seed).mod(maxTokenID), 32);
            tokens.push([token]);
        }

        const tree = StandardMerkleTree.of(tokens, ["bytes32"]);

        return { tokens, tree };
      }

      let seed = hexZeroPad(hexlify(999), 32);

      const { tokens, tree } = makeTree(seed, 80000, 100000);

      await tokenIDFilterMock.setTokenIDFilter(collection, tree.root, data);

      const { leaves, proof, proofFlags } = tree.getMultiProof([1, 3, 5, 7]);
      const subset = leaves.map(l => l[0]);

      expect(await tokenIDFilterMock.acceptsTokenIDs(subset, proof, proofFlags))
        .to.equal(true);
    });
  });
});
