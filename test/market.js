const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Market", function () {
    async function deployMarketFixture() {
        const [owner, locker, other] = await ethers.getSigners();

        const Fee = await ethers.getContractFactory("MarketFee");
        const fee = await Fee.deploy();

        const Market = await ethers.getContractFactory("Market");
        const market = await Market.deploy(await fee.getAddress());

        const Token = await ethers.getContractFactory("TestToken");
        const token = await Token.deploy();

        return { fee, market, token, owner, locker, other };
    }

    async function newTicketSignature(token, market, owner, ticketId, number) {
        const { chainId } = await ethers.provider.getNetwork();

        return await owner.signTypedData(
            { name: "PM", version: "1", chainId, verifyingContract: market },
            {
                NewTicket: [
                    { name: "token", type: "address" },
                    { name: "ticketId", type: "uint256" },
                    { name: "number", type: "uint256" },
                ],
            },
            { token, ticketId, number }
        );
    }

    async function rebateSignature(owner, fee, token, to, number, nonce) {
        const { chainId } = await ethers.provider.getNetwork();

        return await owner.signTypedData(
            { name: "PMFee", version: "1", chainId, verifyingContract: fee },
            {
                Rebate: [
                    { name: "token", type: "address" },
                    { name: "to", type: "address" },
                    { name: "number", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                ],
            },
            { token, to, number, nonce }
        );
    }

    describe("token", function () {
        it("total supply", async function () {
            const { token, owner } = await loadFixture(deployMarketFixture);

            const ownerTokens = await token.balanceOf(owner.address);
            expect(await token.totalSupply()).to.equal(ownerTokens);
        });
    });

    describe("market", function () {
        describe("token", function () {
            it("set token", async function () {
                const { market, token } = await loadFixture(
                    deployMarketFixture
                );

                const tokenAddress = await token.getAddress();
                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                expect(await market.tokenState(tokenAddress)).to.equal(true);
            });

            it("should fail if the sender is not in the owner", async function () {
                const { market, token, locker } = await loadFixture(
                    deployMarketFixture
                );

                const tokenAddress = await token.getAddress();
                await expect(
                    market.connect(locker).setTokenState(tokenAddress, true)
                ).to.be.reverted;
            });
        });

        describe("fee", function () {
            it("set fee", async function () {
                const { market } = await loadFixture(deployMarketFixture);

                await expect(market.setFeeRate(10, 100))
                    .to.emit(market, "SetRate")
                    .withArgs(10, 100);
                expect(await market.rate()).to.equal(10);
                expect(await market.rateBase()).to.equal(100);
            });

            it("should fail if the sender is not in the owner", async function () {
                const { market, locker } = await loadFixture(
                    deployMarketFixture
                );

                await expect(market.connect(locker).setFeeRate(10, 100)).to.be
                    .reverted;
            });

            it("should fail if the rate too large", async function () {
                const { market } = await loadFixture(deployMarketFixture);

                await expect(market.setFeeRate(101, 100)).to.be.revertedWith(
                    "rate must less than base"
                );
            });
        });

        describe("new ticket", function () {
            it("fail, not enable token", async function () {
                const { market, token, owner } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                ).to.be.revertedWith("token should enable");
            });

            it("fail, not approve token", async function () {
                const { market, token, owner } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );
                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                ).to.be.revertedWith(
                    "the allowance is insufficient to pay for this order"
                );
            });

            it("success", async function () {
                const { market, token, owner } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                expect(await market.ticketState(ticketId)).to.equal(1);
            });
        });

        describe("lock ticket", function () {
            it("fail, tick not exit", async function () {
                const { market, locker } = await loadFixture(
                    deployMarketFixture
                );

                await expect(
                    market.connect(locker).lockTicket(0)
                ).to.be.revertedWith("ticket id must exists");
            });

            it("fail, not approve token", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);

                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    market.connect(locker).lockTicket(ticketId)
                ).to.be.revertedWith(
                    "the allowance is insufficient to pay for this order"
                );
            });

            it("success", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);

                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
            });
        });

        describe("cancel ticket", function () {
            it("cancel by seller fail", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);

                await expect(
                    market.connect(locker).cancelTicket(ticketId)
                ).to.be.revertedWith("must called by the seller");
            });

            it("cancel by seller", async function () {
                const { market, token, owner } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);

                await expect(market.cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(owner.address, ticketId, 4);
            });

            it("cancel by locker fail", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);

                await expect(market.cancelTicket(ticketId)).to.be.revertedWith(
                    "must called by the locker"
                );
            });

            it("cancel by locker", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);

                await expect(market.connect(locker).cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(locker.address, ticketId, 3);
            });
        });

        describe("free ticket", function () {
            it("cancel by locker, fail with sender", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.connect(locker).cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(locker.address, ticketId, 3);

                await expect(
                    market.connect(locker).freeTicket(ticketId)
                ).to.be.revertedWith("must call by seller to finished cancel");
            });

            it("cancel by locker, success", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.connect(locker).cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(locker.address, ticketId, 3);

                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 5);
            });

            it("ship, fail with locker", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);

                await expect(
                    market.connect(locker).freeTicket(ticketId)
                ).to.be.revertedWith("must call by seller to ship");
            });

            it("ship success", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);

                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 6);
            });

            it("with receiver, fail with seller", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 6);

                await expect(market.freeTicket(ticketId)).to.be.revertedWith(
                    "must call by locker to finished"
                );
            });

            it("with receiver success", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 6);

                await expect(market.connect(locker).freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(locker.address, ticketId, 7);
            });

            it("with approve, fail with time", async function () {
                const { market, token, owner, locker, other } =
                    await loadFixture(deployMarketFixture);

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(token.transfer(other.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, other.address, number);

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(
                    token.connect(other).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(other.address, marketAddress, number);
                await expect(
                    market
                        .connect(other)
                        .newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(other.address, tokenAddress, ticketId, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.connect(other).freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(other.address, ticketId, 6);

                await expect(
                    market.connect(other).approve(ticketId)
                ).to.be.revertedWith("time has not come");
            });

            it("with approve, fail with other", async function () {
                const { market, token, owner, locker, other } =
                    await loadFixture(deployMarketFixture);

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(token.transfer(other.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, other.address, number);

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(
                    token.connect(other).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(other.address, marketAddress, number);
                await expect(
                    market
                        .connect(other)
                        .newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(other.address, tokenAddress, ticketId, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.connect(other).freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(other.address, ticketId, 6);

                const t = await market.timeDiff();
                time.increase(t);
                await expect(market.approve(ticketId)).to.be.revertedWith(
                    "sender is not seller"
                );
            });

            it("with approve owner", async function () {
                const { market, token, owner, locker, other } =
                    await loadFixture(deployMarketFixture);

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(token.transfer(other.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, other.address, number);

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(
                    token.connect(other).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(other.address, marketAddress, number);
                await expect(
                    market
                        .connect(other)
                        .newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(other.address, tokenAddress, ticketId, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.connect(other).freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(other.address, ticketId, 6);

                const t = await market.timeDiff();
                time.increase(t);
                await expect(market.connect(other).approve(ticketId))
                    .to.emit(market, "Approval")
                    .withArgs(other.address, ticketId);

                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 7);
            });
        });

        describe("unstake", function () {
            it("unstake with unlock cancel, fail with other address", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(market.cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(owner.address, ticketId, 4);

                await expect(
                    market.connect(locker).unStake(ticketId)
                ).to.be.revertedWith("must called by the seller");
            });

            it("unstake with unlock cancel", async function () {
                const { market, token, owner } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(market.cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(owner.address, ticketId, 4);

                const beforeBalance = await token.balanceOf(owner.address);
                await expect(market.unStake(ticketId))
                    .to.emit(market, "UnStake")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                const afterBalance = await token.balanceOf(owner.address);
                expect(afterBalance - beforeBalance).to.equal(number);
            });

            it("unstake with locked cancel, fail with other", async function () {
                const { market, token, owner, locker, other } =
                    await loadFixture(deployMarketFixture);

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.connect(locker).cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(locker.address, ticketId, 3);
                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 5);

                await expect(
                    market.connect(other).unStake(ticketId)
                ).to.be.revertedWith("parties to the transaction");
            });

            it("unstake with locked cancel", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.connect(locker).cancelTicket(ticketId))
                    .to.emit(market, "CancelTicket")
                    .withArgs(locker.address, ticketId, 3);
                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 5);

                let beforeBalance = await token.balanceOf(owner.address);
                await expect(market.unStake(ticketId))
                    .to.emit(market, "UnStake")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                let afterBalance = await token.balanceOf(owner.address);
                expect(afterBalance - beforeBalance).to.equal(number);

                beforeBalance = await token.balanceOf(locker.address);
                await expect(market.connect(locker).unStake(ticketId))
                    .to.emit(market, "UnStake")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                afterBalance = await token.balanceOf(locker.address);
                expect(afterBalance - beforeBalance).to.equal(number);
            });

            it("unstake with finished, fail with locker", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 6);
                await expect(market.connect(locker).freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(locker.address, ticketId, 7);

                await expect(
                    market.connect(locker).unStake(ticketId)
                ).to.be.revertedWith("must called by the seller");
            });

            it("unstake with finished", async function () {
                const { market, token, owner, locker } = await loadFixture(
                    deployMarketFixture
                );

                const ticketId = 0;
                const number = 100;
                const tokenAddress = await token.getAddress();
                const marketAddress = await market.getAddress();
                const signature = await newTicketSignature(
                    tokenAddress,
                    marketAddress,
                    owner,
                    ticketId,
                    number
                );

                await expect(market.setTokenState(tokenAddress, true))
                    .to.emit(market, "TokenState")
                    .withArgs(tokenAddress, true);
                await expect(token.approve(marketAddress, number))
                    .to.emit(token, "Approval")
                    .withArgs(owner.address, marketAddress, number);
                await expect(
                    market.newTicket(tokenAddress, ticketId, number, signature)
                )
                    .to.emit(market, "NewTicket")
                    .withArgs(owner.address, tokenAddress, ticketId, number);
                await expect(token.transfer(locker.address, number))
                    .to.emit(token, "Transfer")
                    .withArgs(owner.address, locker.address, number);
                await expect(
                    token.connect(locker).approve(marketAddress, number)
                )
                    .to.emit(token, "Approval")
                    .withArgs(locker.address, marketAddress, number);
                await expect(market.connect(locker).lockTicket(ticketId))
                    .to.emit(market, "LockTicket")
                    .withArgs(locker.address, tokenAddress, ticketId, number);
                await expect(market.freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(owner.address, ticketId, 6);
                await expect(market.connect(locker).freeTicket(ticketId))
                    .to.emit(market, "FreeTicket")
                    .withArgs(locker.address, ticketId, 7);

                let beforeBalance = await token.balanceOf(owner.address);
                await expect(market.unStake(ticketId))
                    .to.emit(market, "UnStake")
                    .withArgs(
                        owner.address,
                        tokenAddress,
                        ticketId,
                        number * 2
                    );
                let afterBalance = await token.balanceOf(owner.address);
                expect(afterBalance - beforeBalance).to.equal(number * 2);
            });
        });
    });

    describe("fee", function () {
        it("rebate fail with no fee", async function () {
            const { fee, token, owner, locker } = await loadFixture(
                deployMarketFixture
            );
            const tokenAddress = await token.getAddress();
            const feeAddress = await fee.getAddress();
            const number = 100;

            const signature = await rebateSignature(
                owner,
                feeAddress,
                tokenAddress,
                locker.address,
                number,
                1
            );
            await expect(
                fee.connect(locker).rebate(tokenAddress, number, 1, signature)
            ).to.be.revertedWith("fee must more than zero");
        });

        it("rebate fail with not owner sign", async function () {
            const { market, fee, token, owner, locker } = await loadFixture(
                deployMarketFixture
            );
            const tokenAddress = await token.getAddress();
            const marketAddress = await market.getAddress();
            const feeAddress = await fee.getAddress();
            let signature = await newTicketSignature(
                tokenAddress,
                marketAddress,
                owner,
                0,
                100
            );

            await expect(market.setFeeRate(10, 100))
                .to.emit(market, "SetRate")
                .withArgs(10, 100);
            await expect(market.setTokenState(tokenAddress, true))
                .to.emit(market, "TokenState")
                .withArgs(tokenAddress, true);
            await expect(token.approve(marketAddress, 100))
                .to.emit(token, "Approval")
                .withArgs(owner.address, marketAddress, 100);
            await expect(market.newTicket(tokenAddress, 0, 100, signature))
                .to.emit(market, "NewTicket")
                .withArgs(owner.address, tokenAddress, 0, 100);
            await expect(token.transfer(locker.address, 110))
                .to.emit(token, "Transfer")
                .withArgs(owner.address, locker.address, 110);
            await expect(token.connect(locker).approve(marketAddress, 110))
                .to.emit(token, "Approval")
                .withArgs(locker.address, marketAddress, 110);
            await expect(market.connect(locker).lockTicket(0))
                .to.emit(market, "LockTicket")
                .withArgs(locker.address, tokenAddress, 0, 100);
            await expect(market.freeTicket(0))
                .to.emit(market, "FreeTicket")
                .withArgs(owner.address, 0, 6);
            await expect(market.connect(locker).freeTicket(0))
                .to.emit(market, "FreeTicket")
                .withArgs(locker.address, 0, 7);

            const number = 10;
            signature = await rebateSignature(
                locker,
                feeAddress,
                tokenAddress,
                locker.address,
                number,
                1
            );
            await expect(
                fee.connect(locker).rebate(tokenAddress, number, 1, signature)
            ).to.be.revertedWith("must signed by owner");
        });

        it("rebate", async function () {
            const { market, token, fee, owner, locker } = await loadFixture(
                deployMarketFixture
            );
            const tokenAddress = await token.getAddress();
            const marketAddress = await market.getAddress();
            const feeAddress = await fee.getAddress();
            let signature = await newTicketSignature(
                tokenAddress,
                marketAddress,
                owner,
                0,
                100
            );

            await expect(market.setFeeRate(10, 100))
                .to.emit(market, "SetRate")
                .withArgs(10, 100);
            await expect(market.setTokenState(tokenAddress, true))
                .to.emit(market, "TokenState")
                .withArgs(tokenAddress, true);
            await expect(token.approve(marketAddress, 110))
                .to.emit(token, "Approval")
                .withArgs(owner.address, marketAddress, 110);
            await expect(market.newTicket(tokenAddress, 0, 100, signature))
                .to.emit(market, "NewTicket")
                .withArgs(owner.address, tokenAddress, 0, 100);
            await expect(token.transfer(locker.address, 110))
                .to.emit(token, "Transfer")
                .withArgs(owner.address, locker.address, 110);
            await expect(token.connect(locker).approve(marketAddress, 110))
                .to.emit(token, "Approval")
                .withArgs(locker.address, marketAddress, 110);
            await expect(market.connect(locker).lockTicket(0))
                .to.emit(market, "LockTicket")
                .withArgs(locker.address, tokenAddress, 0, 100);
            await expect(market.freeTicket(0))
                .to.emit(market, "FreeTicket")
                .withArgs(owner.address, 0, 6);
            await expect(market.connect(locker).freeTicket(0))
                .to.emit(market, "FreeTicket")
                .withArgs(locker.address, 0, 7);

            const number = 10;
            signature = await rebateSignature(
                owner,
                feeAddress,
                tokenAddress,
                locker.address,
                number,
                1
            );
            await expect(
                fee.connect(locker).rebate(tokenAddress, number, 1, signature)
            )
                .to.emit(fee, "Rebate")
                .withArgs(locker.address, tokenAddress, number);

            let beforeBalance = await token.balanceOf(owner.address);
            await expect(market.unStake(0))
                .to.emit(market, "UnStake")
                .withArgs(owner.address, tokenAddress, 0, 200 - number);
            let afterBalance = await token.balanceOf(owner.address);
            expect(afterBalance - beforeBalance).to.equal(200 - number);
        });
    });
});
