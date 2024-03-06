const { ethers } = require("hardhat");

async function main() {
    const fee = await ethers.deployContract("MarketFee");
    await fee.waitForDeployment();
    console.log(`market fee deployed to ${fee.target}`);

    const market = await ethers.deployContract("Market", [fee.target]);
    await market.waitForDeployment();
    console.log(`market deployed to ${market.target}`);

    let tx = await market.setTokenState(
        "4300000000000000000000000000000000000003",
        true
    );
    await tx.wait();
    console.log(`set token enable with ${tx.hash}`);

    tx = await market.setAllowedAddress(
        "0x4300000000000000000000000000000000000003",
        true
    );
    await tx.wait();
    console.log(`set usdb rebasing address enable with ${tx.hash}`);

    tx = await market.setAllowedAddress(
        "0x4300000000000000000000000000000000000002",
        true
    );
    await tx.wait();
    console.log(`set gas rebasing address enable with ${tx.hash}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
