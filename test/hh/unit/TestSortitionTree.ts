import { ethers } from "hardhat";

describe("TestSortitionTree", function () {
  it("should work", async function () {
    const TestSortitionTree = await ethers.getContractFactory(
      "TestSortitionTree"
    );
    const testSortitionTree = await TestSortitionTree.deploy();
    await testSortitionTree.deployed();

    const [user0, user1] = await ethers.getSigners();
    const stake = ethers.utils.parseEther("123");

    console.log("user0", user0.address);

    await testSortitionTree.connect(user0).setStake(stake, user0.address);
    console.log(
      "user0 stake",
      await testSortitionTree.connect(user0).getStake(user0.address)
    );

    console.log("draw", await testSortitionTree.connect(user0).draw(1));

    await testSortitionTree.setStake(stake, user1.address);
    console.log(
      "user1 stake",
      await testSortitionTree.connect(user1).getStake(user1.address)
    );

    await testSortitionTree
      .connect(user0)
      .setStake(stake.mul(2), user0.address);
    // Console.log(
    //   "user0 stake",
    //   await testSortitionTree.connect(user0).getStake(user0.address)
    // ); // Doesnt impact or add to the stake

    // // loop through 100 times and draw
    // const draws = [];
    // for (let i = 0; i < 100; i++) {
    //   const thisDraw = await testSortitionTree.connect(user0).draw(i);
    //   draws.push(thisDraw);
    //   console.log("draw", thisDraw);
    // }

    await testSortitionTree
      .connect(user0)
      .setStake(stake.mul(2).sub(1), user0.address); // Most minor change posible

    // const drawsMutate = [];
    // for (let i = 0; i < 100; i++) {
    //   const thisDraw = await testSortitionTree.connect(user0).draw(i);
    //   drawsMutate.push(thisDraw);
    //   console.log("drawsMutate", thisDraw);
    // }

    // // Check if the draws are the same
    // for (let i = 0; i < 100; i++) {
    //   console.log(
    //     "draws[i]",
    //     draws[i],
    //     "drawsMutate[i]",
    //     drawsMutate[i],
    //     "draws[i] == drawsMutate[i]",
    //     draws[i] == drawsMutate[i]
    //   );
    // }

    // Console.log('setting user stake to 0')
    // await testSortitionTree.connect(user0).setStake(0,user0.address)

    // // loop through 100 times and draw
    // for (let i = 0; i < 100; i++) {
    //     console.log('draw (solo)', await testSortitionTree.connect(user0).draw(i))
    // }
  });
});
