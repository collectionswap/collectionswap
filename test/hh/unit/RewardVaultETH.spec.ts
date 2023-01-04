import {
  loadFixture,
  mine,
  time,
  mineUpTo,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  makeRewardVaultFixture,
  test721EnumerableFixture,
  test721Fixture,
} from "../shared/fixtures";
import { mintRandomNfts } from "../shared/helpers";

import type {
  ICollectionPoolFactory,
  ICurve,
  IERC20,
  MonotonicIncreasingValidator,
  RewardVaultETH,
  Test721Enumerable,
} from "../../../typechain-types";
import type { NFTFixture } from "../shared/fixtures";
import type { LogDescription } from "@ethersproject/abi";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumberish, ContractTransaction } from "ethers";

describe("RewardVaultETH", function () {
  generateAllSuites((nftFixture) => {
    let factory: ICollectionPoolFactory;
    let monotonicIncreasingValidator: MonotonicIncreasingValidator;
    let curve: ICurve;
    let allRewardTokens: IERC20[];
    let rewardTokens: IERC20[];
    let rewards: BigNumberish[];
    let lpTokenId: BigNumberish;
    let lpTokenId1: BigNumberish;
    let rewardVault: RewardVaultETH;
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let user1: SignerWithAddress;
    let collection: SignerWithAddress;
    let nft: Test721Enumerable;
    // Let nftTokenIds: BigNumberish[];
    let params: any;

    const numRewardTokens = 2;
    const dayDuration = 86400;
    // Removing the last few digits when comparing, since we have 18
    // so this should be fine
    const removePrecision = 1000000;

    const rewardDuration = dayDuration;

    const rewardVaultFixture = makeRewardVaultFixture(nftFixture);

    describe(`Using ${nftFixture.name}`, function () {
      beforeEach(async function () {
        ({
          factory,
          monotonicIncreasingValidator,
          curve,
          allRewardTokens,
          rewardTokens,
          rewards,
          nft,
          // NftTokenIds,
          lpTokenId,
          lpTokenId1,
          rewardVault,
          owner,
          user,
          user1,
          collection,
          params,
        } = await loadFixture(rewardVaultFixture));
      });

      async function getPoolAddress(tx: ContractTransaction, showGas = false) {
        const receipt = await tx.wait();
        if (showGas) {
          console.log("gas used:", receipt.cumulativeGasUsed);
        }

        const event = receipt.events!.find((event) => event.event === "Staked");
        expect(event).to.exist;
        const stakedTokenId = event!.args!.tokenId;

        const descriptions = receipt
          .events!.map((event) => {
            try {
              return factory.interface.parseLog(event);
            } catch (e) {
              return null;
            }
          })
          .filter((x) => x) as LogDescription[];

        const description = descriptions.find(
          (description) => description.name === "NewPool"
        );
        const { poolAddress: newPoolAddress, tokenId: newTokenId } =
          description!.args;

        expect(stakedTokenId).to.equal(newTokenId);

        return { newPoolAddress, newTokenId };
      }

      describe("Deployment", function () {
        it("Should deploy", async function () {
          await loadFixture(rewardVaultFixture);
        });
      });

      describe("Initialize", function () {
        it("Should throw if initialize twice", async function () {
          const rewards = [
            ethers.utils.parseEther("5"),
            ethers.utils.parseEther("7"),
          ];
          const startTime = (await time.latest()) + 1000;
          const endTime = startTime + rewardDuration;
          const rewardRates = rewards.map((reward) =>
            reward.div(endTime - startTime)
          );
          await expect(
            rewardVault.initialize(
              collection.address,
              owner.address,
              factory.address,
              monotonicIncreasingValidator.address,
              nft.address,
              curve.address,
              {
                spotPrice: 0,
                delta: ethers.utils.parseEther("1.5"),
                props: [],
                state: [],
              },
              0,
              ethers.BigNumber.from("200000000000000000"),
              ethers.constants.HashZero,
              rewardTokens.map((rewardToken) => rewardToken.address),
              rewardRates,
              startTime,
              endTime
            )
          ).to.be.revertedWith(
            "Initializable: contract is already initialized"
          );
        });
      });

      describe("Stake", function () {
        it("Should mint contribution", async function () {
          await factory.approve(rewardVault.address, lpTokenId);

          await rewardVault.stake(lpTokenId);
          expect(await factory.ownerOf(lpTokenId)).to.equal(
            rewardVault.address
          );
          expect(await rewardVault.balanceOf(user.address)).to.not.equal(0);
        });
      });

      describe("Withdraw", function () {
        it("Should burn contribution", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);

          await rewardVault.withdraw(lpTokenId);
          expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
          expect(await rewardVault.balanceOf(user.address)).to.equal(0);
        });
      });

      describe("GetReward", function () {
        it("Should be entitled to full rewards if staked before rewards start", async function () {
          await factory.connect(user).approve(rewardVault.address, lpTokenId);
          await rewardVault.connect(user).stake(lpTokenId);

          // Mine to after rewards finish
          await time.increase(2 * rewardDuration);
          await rewardVault.exit(lpTokenId);
          for (let i = 0; i < numRewardTokens; i++) {
            const reward = rewards[i];
            const userReward = await rewardTokens[i].balanceOf(user.address);
            expect(userReward).to.approximately(reward, removePrecision);
          }
        });

        it("Should get 0 rewards if exit before rewards start", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);

          // Mine to before rewards start
          await time.setNextBlockTimestamp(await rewardVault.lastUpdateTime());
          await rewardVault.exit(lpTokenId);
          for (let i = 0; i < numRewardTokens; i++) {
            expect(await rewardTokens[i].balanceOf(user.address)).to.equal(0);
          }
        });

        it("Should get reward after staking", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);

          // Mine to after start time
          await time.increaseTo((await rewardVault.lastUpdateTime()).add(1));
          await rewardVault.getReward();
          for (let i = 0; i < numRewardTokens; i++) {
            expect(await rewardTokens[i].balanceOf(user.address)).to.not.equal(
              0
            );
          }
        });

        it("Should not get reward after exit", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);
          await rewardVault.exit(lpTokenId);

          const response = await rewardVault.getReward();
          const receipt = await response.wait();
          expect(receipt.events).to.be.empty;
        });

        it("Should not be able to get reward if pool not started", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);

          // The user should still be able to stake and see his stake
          expect(await rewardVault.balanceOf(user.address)).to.not.equal(0);

          // Time passes
          await time.increase(300);
          const startingBlock = await time.latestBlock();
          const endBlock = startingBlock + 100;
          await mineUpTo(endBlock);

          // But there's no reward after exit.
          await rewardVault.exit(lpTokenId);
          for (let i = 0; i < numRewardTokens; i++) {
            expect(await rewardTokens[i].balanceOf(user.address)).to.equal(0);
          }
        });

        it("One single stake. User takes every reward after the duration is over", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);
          // The user should still be able to stake and see his stake
          expect(await rewardVault.balanceOf(user.address)).to.not.equal(0);

          // Time passes
          await mine();
          await time.increase(2 * rewardDuration);
          await mine();

          // Get the reward period
          const period = rewardDuration;

          // Make sure the time has passed
          expect(await time.latest()).to.greaterThan(
            await rewardVault.periodFinish()
          );

          // The only user should get most rewards
          // there will be some dust in the contract
          await rewardVault.exit(lpTokenId);

          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            const rewardRate = await rewardVault.rewardRates(
              rewardToken.address
            );

            const userReward = await rewardToken.balanceOf(user.address);

            const reward = rewardRate.mul(period);
            expect(userReward).to.approximately(reward, removePrecision);
          }
        });

        it("Two users who staked the same amount right from the beginning", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);
          await factory.connect(user1).approve(rewardVault.address, lpTokenId1);
          await rewardVault.connect(user1).stake(lpTokenId1);
          // The user should still be able to stake and see his stake
          expect(await rewardVault.balanceOf(user.address)).to.not.equal(0);
          expect(await rewardVault.balanceOf(user1.address)).to.not.equal(0);

          // Time passes
          await mine();
          await time.increase(rewardDuration * 2);
          await mine();

          // Get the reward period
          const period = rewardDuration;

          // Make sure the time has passed
          expect(await time.latest()).to.greaterThan(
            await rewardVault.periodFinish()
          );

          // The only user should get most rewards
          // there will be some dust in the contract
          await rewardVault.exit(lpTokenId);
          await rewardVault.connect(user1).exit(lpTokenId1);

          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            const rewardRate = await rewardVault.rewardRates(
              rewardToken.address
            );

            const userReward = await rewardToken.balanceOf(user.address);
            const userReward1 = await rewardToken.balanceOf(user1.address);

            const reward = rewardRate.mul(period).div(2);
            expect(userReward).to.approximately(reward, removePrecision);
            expect(userReward1).to.approximately(reward, removePrecision);
          }
        });
      });

      it("Two users who staked the same amount, but one later.", async function () {
        await factory.approve(rewardVault.address, lpTokenId);
        await rewardVault.stake(lpTokenId);
        // The user should still be able to stake and see his stake
        expect(await rewardVault.balanceOf(user.address)).to.not.equal(0);

        const poolStartTime = (await rewardVault.lastUpdateTime()).toNumber();

        // Time passes
        await mine();
        await time.increase(rewardDuration / 2);
        await mine();

        await factory.connect(user1).approve(rewardVault.address, lpTokenId1);
        await rewardVault.connect(user1).stake(lpTokenId1);
        const user1StakeTime = await time.latest();

        await mine();
        await time.increase(rewardDuration);
        await mine();

        // Get the reward period
        const periodFinish = (await rewardVault.periodFinish()).toNumber();

        const phase1 = user1StakeTime - poolStartTime;
        const phase2 = periodFinish - user1StakeTime;

        // Make sure the time has passed
        expect(await time.latest()).to.greaterThan(
          await rewardVault.periodFinish()
        );

        // The only user should get most rewards
        // there will be some dust in the contract
        // await rewardVault.connect(owner).exit(lpTokenId);
        await expect(
          rewardVault.connect(user1).exit(lpTokenId)
        ).to.be.revertedWithCustomError(rewardVault, "Unauthorized");
        await rewardVault.exit(lpTokenId);
        await rewardVault.connect(user1).exit(lpTokenId1);

        for (let i = 0; i < numRewardTokens; i++) {
          const rewardToken = rewardTokens[i];
          const rewardRate = await rewardVault.rewardRates(rewardToken.address);

          const userReward = await rewardToken.balanceOf(user.address);
          const userReward1 = await rewardToken.balanceOf(user1.address);

          const reward1 = rewardRate.mul(phase2).div(2);
          const reward = rewardRate.mul(phase1).add(reward1);
          expect(userReward).to.approximately(reward, removePrecision);
          expect(userReward1).to.approximately(reward1, removePrecision);
        }
      });

      describe("Recharging the pool", function () {
        for (let extra = 1; extra <= 1; extra++) {
          it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should fail due to bad config (from collection AKA protocol owner)`, async function () {
            await factory.approve(rewardVault.address, lpTokenId);
            await rewardVault.stake(lpTokenId);
            const startIndex = 0;
            const lengthTokens = extra;
            const endIndex = startIndex + lengthTokens;
            const otherRewardTokens = allRewardTokens.slice(
              startIndex,
              endIndex
            );
            // Console.log(otherRewardTokens.map(token => token.address))
            const newRewardAmount = ethers.utils.parseEther("69");
            const newRewardsList = [];
            for (let i = startIndex; i < endIndex; i++) {
              const rewardToken = allRewardTokens[i];
              newRewardsList.push(newRewardAmount);
              // @ts-ignore
              await rewardToken.mint(collection.address, newRewardAmount);
              await rewardToken
                .connect(collection)
                .approve(rewardVault.address, newRewardAmount);
            }

            const otherRewards = otherRewardTokens.map((_) =>
              ethers.utils.parseEther("69")
            );
            await mine();
            await time.increase(rewardDuration * 2);
            await mine();
            expect(await time.latest()).to.greaterThan(
              await rewardVault.periodFinish()
            );
            const newEndTime = (await time.latest()) + 1000 + rewardDuration;
            await expect(
              rewardVault.connect(collection).rechargeRewardVault(
                otherRewardTokens.map((token) => token.address),
                otherRewards,
                newEndTime
              )
            ).to.be.revertedWithCustomError(
              rewardVault,
              "MissingExistingTokens"
            );
          });
        }

        for (let extra = 2; extra <= 5; extra++) {
          it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should succeed (from collection AKA protocol owner)`, async function () {
            await factory.approve(rewardVault.address, lpTokenId);
            await rewardVault.stake(lpTokenId);
            const startIndex = 0;
            const lengthTokens = extra;
            const endIndex = startIndex + lengthTokens;
            const otherRewardTokens = allRewardTokens.slice(
              startIndex,
              endIndex
            );
            // Console.log(otherRewardTokens.map(token => token.address))
            const newRewardAmount = ethers.utils.parseEther("69");
            const newRewardsList = [];
            for (let i = startIndex; i < endIndex; i++) {
              const rewardToken = allRewardTokens[i];
              newRewardsList.push(newRewardAmount);
              // @ts-ignore
              await rewardToken.mint(collection.address, newRewardAmount);
              await rewardToken
                .connect(collection)
                .approve(rewardVault.address, newRewardAmount);
            }

            const otherRewards = otherRewardTokens.map((_) =>
              ethers.utils.parseEther("69")
            );
            await mine();
            await time.increase(rewardDuration * 2);
            await mine();
            expect(await time.latest()).to.greaterThan(
              await rewardVault.periodFinish()
            );
            const newEndTime = (await time.latest()) + 1000 + rewardDuration;

            await rewardVault.connect(collection).rechargeRewardVault(
              otherRewardTokens.map((token) => token.address),
              otherRewards,
              newEndTime
            );

            // Concat rewards and tokens
            const expectedRewardTokens = [];
            // Get the max of rewards.length and lengthTokens
            for (let i = 0; i < Math.max(rewards.length, lengthTokens); i++) {
              let n = ethers.utils.parseEther("0");
              if (i < rewards.length) {
                n = n.add(rewards[i]);
              }

              if (i < lengthTokens) {
                n = n.add(newRewardsList[i]);
              }

              expectedRewardTokens.push(n);
            }

            await mine();
            await time.increase(rewardDuration * 2);
            await mine();
            await rewardVault.getReward();
            for (let i = 0; i < expectedRewardTokens.length; i++) {
              // Console.log(await allRewardTokens[i].balanceOf(user.address))
              // console.log(expectedRewardTokens[i])
              expect(
                await allRewardTokens[i].balanceOf(user.address)
              ).to.approximately(expectedRewardTokens[i], removePrecision);
              // Console.log(await rewardTokens(i))
              // try { console.log(await rewardVault.rewardTokens(i)) } catch (error) {}
            }
          });
        }

        for (let extra = 2; extra <= 5; extra++) {
          it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should succeed (from pool deployer)`, async function () {
            for (let i = 0; i < 5; i++) {
              // Try { console.log(await rewardVault.rewardTokens(i)) } catch (error) {}
            }

            await factory.approve(rewardVault.address, lpTokenId);
            await rewardVault.stake(lpTokenId);
            const startIndex = 0;
            const lengthTokens = extra;
            const endIndex = startIndex + lengthTokens;
            const otherRewardTokens = allRewardTokens.slice(
              startIndex,
              endIndex
            );
            // Console.log(otherRewardTokens.map(token => token.address))
            const newRewardAmount = ethers.utils.parseEther("69");
            const newRewardsList = [];
            for (let i = startIndex; i < endIndex; i++) {
              const rewardToken = allRewardTokens[i];
              newRewardsList.push(newRewardAmount);
              // @ts-ignore
              await rewardToken.mint(owner.address, newRewardAmount);
              await rewardToken.approve(rewardVault.address, newRewardAmount);
            }

            const otherRewards = otherRewardTokens.map((_) =>
              ethers.utils.parseEther("69")
            );
            await mine();
            await time.increase(rewardDuration * 2);
            await mine();
            expect(await time.latest()).to.greaterThan(
              await rewardVault.periodFinish()
            );
            const newEndTime = (await time.latest()) + 1000 + rewardDuration;
            // Console.log(otherRewardTokens.map(token => token.address))
            await rewardVault.connect(owner).rechargeRewardVault(
              otherRewardTokens.map((token) => token.address),
              otherRewards,
              newEndTime
            );
            // Concat rewards and tokens
            const expectedRewardTokens = [];
            // Get the max of rewards.length and lengthTokens
            for (let i = 0; i < Math.max(rewards.length, lengthTokens); i++) {
              let n = ethers.utils.parseEther("0");
              if (i < rewards.length) {
                n = n.add(rewards[i]);
              }

              if (i < lengthTokens) {
                n = n.add(newRewardsList[i]);
              }

              expectedRewardTokens.push(n);
            }

            // Console.log(expectedRewardTokens);

            await mine();
            await time.increase(rewardDuration * 2);
            await mine();
            await rewardVault.getReward();
            for (let i = 0; i < expectedRewardTokens.length; i++) {
              // Console.log(await allRewardTokens[i].balanceOf(user.address))
              // console.log(expectedRewardTokens[i])
              expect(
                await allRewardTokens[i].balanceOf(user.address)
              ).to.approximately(expectedRewardTokens[i], removePrecision);
              // Console.log(await rewardTokens(i))
              // try { console.log(await rewardVault.rewardTokens(i)) } catch (error) {}
            }
          });
        }

        // MAX_REWARD_TOKENS capped at 5
        // for (let extra = 6; extra <= 10; extra++) {
        //   it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should fail`, async function () {
        //     for (let i = 0; i < 5; i++) {
        //       // Try { console.log(await rewardVault.rewardTokens(i)) } catch (error) {}
        //     }

        //     await factory.approve(rewardVault.address, lpTokenId);
        //     await rewardVault.stake(lpTokenId);
        //     const startIndex = 0;
        //     const lengthTokens = extra;
        //     const endIndex = startIndex + lengthTokens;
        //     const otherRewardTokens = allRewardTokens.slice(startIndex, endIndex);
        //     const newRewardAmount = ethers.utils.parseEther("69");
        //     const newRewardsList = [];
        //     for (let i = startIndex; i < endIndex; i++) {
        //       const rewardToken = allRewardTokens[i];
        //       newRewardsList.push(newRewardAmount);
        //       // @ts-ignore
        //       await rewardToken.mint(owner.address, newRewardAmount);
        //       await rewardToken.approve(rewardVault.address, newRewardAmount);
        //     }

        //     const otherRewards = otherRewardTokens.map((_) =>
        //       ethers.utils.parseEther("69")
        //     );
        //     await mine();
        //     await time.increase(rewardDuration * 2);
        //     await mine();
        //     expect(await time.latest()).to.greaterThan(
        //       await rewardVault.periodFinish()
        //     );
        //     const newEndTime = (await time.latest()) + 1000 + rewardDuration;
        //     // Console.log(otherRewardTokens.map(token => token.address))
        //     await expect(
        //       rewardVault.connect(owner).rechargeRewardVault(
        //         otherRewardTokens.map((token) => token.address),
        //         otherRewards,
        //         newEndTime
        //       )
        //     ).to.be.revertedWith("Exceed max tokens");
        //   });
        // }

        it(`Duplicate reward tokens are not allowed`, async function () {
          for (let i = 0; i < 5; i++) {
            // Try { console.log(await rewardVault.rewardTokens(i)) } catch (error) {}
          }

          const extra = 3;
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);
          const startIndex = 0;
          const lengthTokens = extra;
          const endIndex = startIndex + lengthTokens;
          let otherRewardTokens = allRewardTokens.slice(startIndex, endIndex);
          otherRewardTokens = otherRewardTokens
            .slice(0, extra - 1)
            .concat([otherRewardTokens[1]]);
          // Console.log(otherRewardTokens.map(token => token.address))
          // console.log(otherRewardTokens.length)

          const newRewardAmount = ethers.utils.parseEther("69");
          const newRewardsList = [];
          for (let i = startIndex; i < endIndex; i++) {
            const rewardToken = allRewardTokens[i];
            newRewardsList.push(newRewardAmount);
            // @ts-ignore
            await rewardToken.mint(owner.address, newRewardAmount.mul(2));
            await rewardToken.approve(
              rewardVault.address,
              newRewardAmount.mul(2)
            );
          }

          const otherRewards = otherRewardTokens.map((_) =>
            ethers.utils.parseEther("69")
          );
          await mine();
          await time.increase(rewardDuration * 2);
          await mine();
          expect(await time.latest()).to.greaterThan(
            await rewardVault.periodFinish()
          );
          const newEndTime = (await time.latest()) + 1000 + rewardDuration;
          // Console.log(otherRewardTokens.map(token => token.address))
          await expect(
            rewardVault.connect(owner).rechargeRewardVault(
              otherRewardTokens.map((token) => token.address),
              otherRewards,
              newEndTime
            )
          ).to.be.revertedWithCustomError(rewardVault, "RepeatedToken");
        });

        it("Recharge the pool halfway should fail", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);

          const poolStartTime = (await rewardVault.lastUpdateTime()).toNumber();
          const endTime = (await rewardVault.periodFinish()).toNumber();
          // Time passes
          await mine();
          await time.increase(rewardDuration / 2);
          await mine();
          // Assuming a 50% time extension at halftime, with 1.5 times the original tokens.
          // so the remaining time has 2x the token rate
          // at original endTime, we should have 150% of what we expect

          const midPoint = await time.latest();
          // Need to updateReward? via getReward()???
          await rewardVault.connect(owner).getReward();
          // Console.log('debug',midPoint,await rewardVault.lastUpdateTime())
          const fractionElapsed = (midPoint - poolStartTime) / rewardDuration;
          // Console.log('fraction elapsed', fractionElapsed,(midPoint - poolStartTime));

          const newEndTime = endTime + (endTime - poolStartTime) / 2;
          const additionalRewardQuantum = 2.5;
          const expectedEndAmount =
            (0.5 + additionalRewardQuantum) / 2 + fractionElapsed;
          const additionalRewards = rewards.map((reward) =>
            reward
              // @ts-ignore
              .mul(ethers.utils.parseEther(additionalRewardQuantum.toString()))
              .div(ethers.utils.parseEther("1"))
          );
          rewards.map((reward) =>
            reward
              // @ts-ignore
              .mul(ethers.utils.parseEther(expectedEndAmount.toString()))
              .div(ethers.utils.parseEther("1"))
          );

          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];

            // @ts-ignore
            await rewardToken.mint(owner.address, additionalRewards[i]);
            await rewardTokens[i].approve(
              rewardVault.address,
              additionalRewards[i]
            );
          }

          // Get rewardRates

          const phase1Rewards = [];
          for (const rewardToken of rewardTokens) {
            const rewardRates = await rewardVault.rewardRates(
              rewardToken.address
            );
            // Console.log('reward rate', rewardRates.toString());
            phase1Rewards.push(rewardRates.mul(midPoint - poolStartTime));
          }

          // Recharge the pool
          await expect(
            rewardVault.connect(owner).rechargeRewardVault(
              rewardTokens.map((token) => token.address),
              additionalRewards,
              newEndTime
            )
          ).to.be.revertedWithCustomError(rewardVault, "RewardsOngoing");
        });

        it("Recharge: Two users who staked the same amount, both claim at end of first epoch. ", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);

          await factory.connect(user1).approve(rewardVault.address, lpTokenId1);
          await rewardVault.connect(user1).stake(lpTokenId1);

          await mine();
          await time.increase(rewardDuration * 2);
          await mine();

          await rewardVault.getReward();
          await rewardVault.connect(user1).getReward();

          await Promise.all(
            rewardTokens.map(async (token) =>
              token.balanceOf(rewardVault.address)
            )
          );

          // Iterate through reward tokens and mint a bit more

          const newRewardAmount = ethers.utils.parseEther("69");
          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            // @ts-ignore
            await rewardToken.mint(owner.address, newRewardAmount);
            await rewardTokens[i].approve(rewardVault.address, newRewardAmount);
          }

          // Recharge the pool
          const newEndTime = (await time.latest()) + 1000 + rewardDuration;
          // Balances before, map through rewardtokens
          await Promise.all(
            rewardTokens.map(async (token) =>
              token.balanceOf(rewardVault.address)
            )
          );
          await rewardVault.connect(owner).rechargeRewardVault(
            rewardTokens.map((token) => token.address),
            rewardTokens.map((_) => newRewardAmount),
            newEndTime
          );

          const userBalanceBefore = [];
          for (const thisUser of [user, user1]) {
            userBalanceBefore.push(
              await Promise.all(
                rewardTokens.map(async (token) =>
                  token.balanceOf(thisUser.address)
                )
              )
            );
          }

          await mine();
          await time.increase(rewardDuration / 2);
          await mine();

          // Do fucky stuff
          expect(await time.latest()).to.lessThan(
            await rewardVault.periodFinish()
          );
          await rewardVault.connect(user).getReward();
          await rewardVault.connect(user1).getReward();

          await mine();
          await time.increase(rewardDuration * 2);
          await mine();

          for (const thisUser of [user, user1]) {
            // Console.log('user',thisUser.address)

            // get balances before
            // const balancesBefore = await Promise.all(
            //   rewardTokens.map((token) => token.balanceOf(thisUser.address))
            // );
            const balancesBefore =
              userBalanceBefore[[user, user1].indexOf(thisUser)];

            await rewardVault.connect(thisUser).getReward();

            // Get balances after
            const balancesAfter = await Promise.all(
              rewardTokens.map(async (token) =>
                token.balanceOf(thisUser.address)
              )
            );

            // Balances after, map through rewardtokens
            for (let i = 0; i < numRewardTokens; i++) {
              const diff = balancesAfter[i].sub(balancesBefore[i]);
              const expectedAmount = newRewardAmount.div(2);

              // // user1 did not claim, expect him to get it by the end of next epoch
              // if (thisUser.address === user1.address) {
              //   expectedAmount = expectedAmount.add(rewardTokenPoolBalancePrevEpoch[i])
              // }

              // console.log('diff',rewardTokens[i].address,diff,balancesAfter[i],balancesBefore[i],(newRewardAmount.div(2)),(newRewardAmount.div(2)).add(rewardTokenPoolBalancePrevEpoch[i]))
              expect(diff).to.approximately(expectedAmount, removePrecision);
            }
          }
        });

        it("Recharge: Two users who staked the same amount, both did not claim at end of first epoch. ", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);

          await factory.connect(user1).approve(rewardVault.address, lpTokenId1);
          await rewardVault.connect(user1).stake(lpTokenId1);

          await mine();
          await time.increase(rewardDuration * 2);
          await mine();

          // Await rewardVault.getReward();
          // await rewardVault.connect(user1).getReward();

          const rewardTokenPoolBalancePrevEpoch = await Promise.all(
            rewardTokens.map(async (token) =>
              token.balanceOf(rewardVault.address)
            )
          );

          // Console.log(rewardTokenPoolBalancePrevEpoch)

          // iterate through reward tokens and mint a bit more

          const newRewardAmount = ethers.utils.parseEther("69");
          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            // @ts-ignore
            await rewardToken.mint(owner.address, newRewardAmount);
            await rewardTokens[i].approve(rewardVault.address, newRewardAmount);
          }

          // Recharge the pool
          const newEndTime = (await time.latest()) + 1000 + rewardDuration;
          // Balances before, map through rewardtokens
          await Promise.all(
            rewardTokens.map(async (token) =>
              token.balanceOf(rewardVault.address)
            )
          );
          // Console.log(rewardTokens.map((token) => token.address))
          // console.log(rewardTokens.map((token) => newRewardAmount))
          // console.log(newEndTime)
          await rewardVault.connect(owner).rechargeRewardVault(
            rewardTokens.map((token) => token.address),
            rewardTokens.map((_) => newRewardAmount),
            newEndTime
          );

          const userBalanceBefore = [];
          for (const thisUser of [user, user1]) {
            userBalanceBefore.push(
              await Promise.all(
                rewardTokens.map(async (token) =>
                  token.balanceOf(thisUser.address)
                )
              )
            );
          }

          await mine();
          await time.increase(rewardDuration / 2);
          await mine();

          // Do fucky stuff
          expect(await time.latest()).to.lessThan(
            await rewardVault.periodFinish()
          );
          await rewardVault.connect(user).getReward();
          await rewardVault.connect(user1).getReward();

          await mine();
          await time.increase(rewardDuration * 2);
          await mine();

          for (const thisUser of [user, user1]) {
            // Console.log('user',thisUser.address)

            // get balances before
            const balancesBefore =
              userBalanceBefore[[user, user1].indexOf(thisUser)];

            await rewardVault.connect(thisUser).getReward();

            // Get balances after
            const balancesAfter = await Promise.all(
              rewardTokens.map(async (token) =>
                token.balanceOf(thisUser.address)
              )
            );

            // Balances after, map through rewardtokens
            for (let i = 0; i < numRewardTokens; i++) {
              const diff = balancesAfter[i].sub(balancesBefore[i]);
              let expectedAmount = newRewardAmount.div(2);

              // Both users did not claim, expect him to get it by the end of next epoch
              expectedAmount = expectedAmount.add(
                rewardTokenPoolBalancePrevEpoch[i].div(2)
              );

              // Console.log('diff',rewardTokens[i].address,diff,balancesAfter[i],balancesBefore[i],(newRewardAmount.div(2)),(newRewardAmount.div(2)).add(rewardTokenPoolBalancePrevEpoch[i]))
              expect(diff).to.approximately(expectedAmount, removePrecision);
            }
          }
        });

        it("Recharge: Two users who staked the same amount, one didn't claim at end of first epoch. He gets the token balance he didn't claim at the end of next epoch.", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);
          // The user should still be able to stake and see his stake
          expect(await rewardVault.balanceOf(user.address)).to.not.equal(0);

          const poolStartTime = (await rewardVault.lastUpdateTime()).toNumber();

          // Time passes
          await mine();
          await time.increase(rewardDuration / 2);
          await mine();

          await factory.connect(user1).approve(rewardVault.address, lpTokenId1);
          await rewardVault.connect(user1).stake(lpTokenId1);
          const user1StakeTime = await time.latest();
          expect(await rewardVault.balanceOf(user1.address)).to.not.equal(0);

          await mine();
          await time.increase(rewardDuration);
          await mine();

          // Get the reward period
          const periodFinish = (await rewardVault.periodFinish()).toNumber();

          const phase1 = user1StakeTime - poolStartTime;
          const phase2 = periodFinish - user1StakeTime;

          // Make sure the time has passed
          expect(await time.latest()).to.greaterThan(
            await rewardVault.periodFinish()
          );

          // The only user should get most rewards
          // there will be some dust in the contract
          await rewardVault.getReward();
          //   Await rewardVault.connect(user1).getReward();

          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            const rewardRate = await rewardVault.rewardRates(
              rewardToken.address
            );
            const userReward = await rewardToken.balanceOf(user.address);
            const reward1 = rewardRate.mul(phase2).div(2);
            const reward = rewardRate.mul(phase1).add(reward1);
            expect(userReward).to.approximately(reward, removePrecision);
            // Expect(userReward1).to.approximately(reward1, removePrecision);
          }

          // Get balances
          const rewardTokenPoolBalancePrevEpoch = await Promise.all(
            rewardTokens.map(async (token) =>
              token.balanceOf(rewardVault.address)
            )
          );
          // Console.log(rewardTokenPoolBalancePrevEpoch)

          // iterate through reward tokens and mint a bit more

          const newRewardAmount = ethers.utils.parseEther("69");
          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            // @ts-ignore
            await rewardToken.mint(owner.address, newRewardAmount);
            await rewardTokens[i].approve(rewardVault.address, newRewardAmount);
          }

          // Recharge the pool
          const newEndTime = (await time.latest()) + 1000 + rewardDuration;

          await expect(
            rewardVault.connect(user).rechargeRewardVault(
              rewardTokens.map((token) => token.address),
              rewardTokens.map((_) => newRewardAmount),
              newEndTime
            )
          ).to.be.revertedWithCustomError(rewardVault, "Unauthorized");

          // Balances before, map through rewardtokens
          const balancesBefore = await Promise.all(
            rewardTokens.map(async (token) =>
              token.balanceOf(rewardVault.address)
            )
          );

          await rewardVault.connect(owner).rechargeRewardVault(
            rewardTokens.map((token) => token.address),
            rewardTokens.map((_) => newRewardAmount),
            newEndTime
          );

          const balancesAfter = await Promise.all(
            rewardTokens.map(async (token) =>
              token.balanceOf(rewardVault.address)
            )
          );

          // Balances after, map through rewardtokens
          for (let i = 0; i < numRewardTokens; i++) {
            expect(balancesAfter[i]).to.equal(
              balancesBefore[i].add(newRewardAmount)
            );
            // Console.log(rewardTokens[i].address,balancesAfter[i],balancesBefore[i],(newRewardAmount))
          }

          const userBalanceBefore = [];
          for (const thisUser of [user, user1]) {
            userBalanceBefore.push(
              await Promise.all(
                rewardTokens.map(async (token) =>
                  token.balanceOf(thisUser.address)
                )
              )
            );
          }

          await mine();
          await time.increase(rewardDuration / 2);
          await mine();

          // Do fucky stuff
          expect(await time.latest()).to.lessThan(
            await rewardVault.periodFinish()
          );
          await rewardVault.connect(user).getReward();
          // Await rewardVault.connect(user1).getReward();

          await mine();
          await time.increase(rewardDuration * 2);
          await mine();
          // Make sure the time has passed
          expect(await time.latest()).to.greaterThan(
            await rewardVault.periodFinish()
          );

          for (const thisUser of [user, user1]) {
            // Console.log('user',thisUser.address)

            // get balances before
            const balancesBefore =
              userBalanceBefore[[user, user1].indexOf(thisUser)];
            await rewardVault.connect(thisUser).getReward();

            // Get balances after
            const balancesAfter = await Promise.all(
              rewardTokens.map(async (token) =>
                token.balanceOf(thisUser.address)
              )
            );

            // Balances after, map through rewardtokens
            for (let i = 0; i < numRewardTokens; i++) {
              const diff = balancesAfter[i].sub(balancesBefore[i]);
              let expectedAmount = newRewardAmount.div(2);

              // User1 did not claim, expect him to get it by the end of next epoch
              if (thisUser.address === user1.address) {
                expectedAmount = expectedAmount.add(
                  rewardTokenPoolBalancePrevEpoch[i]
                );
              }

              // Console.log('diff',rewardTokens[i].address,diff,balancesAfter[i],balancesBefore[i],(newRewardAmount.div(2)),(newRewardAmount.div(2)).add(rewardTokenPoolBalancePrevEpoch[i]))
              expect(diff).to.approximately(expectedAmount, removePrecision);
            }
          }

          // // iterate through rewardTokens, check pool balance
          //   for (let i = 0; i < numRewardTokens; i++) {
          //       const rewardToken = rewardTokens[i];
          //       // const poolBalance = await rewardToken.balanceOf(rewardVault.address);
          //       console.log('token',rewardToken.address,
          //           await rewardToken.balanceOf(rewardVault.address), // pool balance
          //           await rewardToken.balanceOf(owner.address),
          //           await rewardToken.balanceOf(user.address),
          //           await rewardToken.balanceOf(user1.address),

          //       )
          //       // expect(poolBalance).to.equal(newRewardAmount.div(2));
          //   }
        });
      });

      describe("Sweep", function () {
        it("should prevent deployer from sweeping rewards early", async function () {
          await expect(
            rewardVault.connect(owner).sweepRewards()
          ).to.be.revertedWithCustomError(rewardVault, "TooEarly");
          // Set block timestamp to just before rewardSweepTime
          await time.setNextBlockTimestamp(
            (await rewardVault.rewardSweepTime()).sub(1)
          );
          await expect(
            rewardVault.connect(owner).sweepRewards()
          ).to.be.revertedWithCustomError(rewardVault, "TooEarly");
        });

        it("should allow deployer to sweep rewards", async function () {
          await time.setNextBlockTimestamp(await rewardVault.rewardSweepTime());
          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            // Console.log(
            //   rewardToken.address,
            //   owner.address,
            //   await rewardToken.balanceOf(rewardVault.address)
            // );
            const expectedChange = await rewardToken.balanceOf(
              rewardVault.address
            );

            await expect(
              rewardVault.connect(owner).sweepRewards()
            ).to.changeTokenBalance(rewardToken, owner.address, expectedChange);
          }
        });

        it("should allow non-deployer to sweep rewards to deployer", async function () {
          await time.setNextBlockTimestamp(await rewardVault.rewardSweepTime());
          for (let i = 0; i < numRewardTokens; i++) {
            const rewardToken = rewardTokens[i];
            // Console.log(
            //   rewardToken.address,
            //   owner.address,
            //   await rewardToken.balanceOf(rewardVault.address)
            // );
            const expectedChange = await rewardToken.balanceOf(
              rewardVault.address
            );

            await expect(
              rewardVault.connect(user1).sweepRewards()
            ).to.changeTokenBalance(rewardToken, owner.address, expectedChange);
          }
        });

        it("should revert if user tries to exit but successfully withdraw", async function () {
          await factory.approve(rewardVault.address, lpTokenId);
          await rewardVault.stake(lpTokenId);
          await time.setNextBlockTimestamp(await rewardVault.rewardSweepTime());
          await rewardVault.connect(owner).sweepRewards();

          await expect(rewardVault.exit(lpTokenId)).to.be.revertedWith(
            "ERC20: transfer amount exceeds balance"
          );

          await rewardVault.withdraw(lpTokenId);
          expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
          expect(await rewardVault.balanceOf(user.address)).to.equal(0);
        });
      });

      describe("Atomic transactions", function () {
        it("Atomic entry, piecemeal exit", async function () {
          //   Await nft.connect(user).setApprovalForAll(rewardVault.address, true);

          // console.log(1);
          const newNftTokenIds = await mintRandomNfts(
            nft.connect(owner),
            user.address
          );
          await nft.connect(user).setApprovalForAll(rewardVault.address, true);
          // Console.log(nft.address);
          // console.log(factory.address);
          // console.log(rewardVault.address);
          // console.log(2);
          await factory
            .connect(user)
            .setApprovalForAll(rewardVault.address, true);
          // Console.log(3);
          const currTokenIdTx = await rewardVault
            .connect(user)
            .atomicPoolAndVault(
              nft.address,
              params.bondingCurve.address,
              params.delta,
              params.fee,
              params.spotPrice,
              params.props,
              params.state,
              params.royaltyNumerator,
              params.royaltyRecipientFallback,
              newNftTokenIds,
              { value: params.value }
            );
          // Console.log(4);
          const { newTokenId: currTokenId } = await getPoolAddress(
            currTokenIdTx
          );

          await rewardVault.exit(currTokenId);
          await factory.setApprovalForAll(factory.address, true);
          await factory.burn(currTokenId);
        });

        it("Atomic entry, atomic exit", async function () {
          //   Await nft.connect(user).setApprovalForAll(rewardVault.address, true);
          const newNftTokenIds = await mintRandomNfts(
            nft.connect(owner),
            user.address
          );
          await nft.connect(user).setApprovalForAll(rewardVault.address, true);
          await factory
            .connect(user)
            .setApprovalForAll(rewardVault.address, true);
          const currTokenIdTx = await rewardVault
            .connect(user)
            .atomicPoolAndVault(
              nft.address,
              params.bondingCurve.address,
              params.delta,
              params.fee,
              params.spotPrice,
              params.props,
              params.state,
              params.royaltyNumerator,
              params.royaltyRecipientFallback,
              newNftTokenIds,
              { value: params.value }
            );

          //   Console.log("nft.ownerOf", await nft.ownerOf(nftTokenIds[0]));

          const { newPoolAddress, newTokenId } = await getPoolAddress(
            currTokenIdTx
          );
          expect((await nft.ownerOf(newNftTokenIds[0])).toLowerCase()).to.equal(
            newPoolAddress.toLowerCase()
          );
          const currTokenId = newTokenId;

          await factory.setApprovalForAll(factory.address, true);
          await expect(
            rewardVault.atomicExitAndUnpool(currTokenId)
          ).to.changeEtherBalances(
            [user, newPoolAddress],
            [params.value, params.value.mul(-1)]
          );

          // Check for each nftTokenIds, user owns them
          for (let i = 0; i < newNftTokenIds.length; i++) {
            expect(await nft.ownerOf(newNftTokenIds[i])).to.equal(user.address);
          }
        });
      });
    });
  });
});

function generateAllSuites(generateSuites: (nftFixure: NFTFixture) => void) {
  for (const nftFixture of [test721Fixture, test721EnumerableFixture]) {
    generateSuites(nftFixture);
  }
}
