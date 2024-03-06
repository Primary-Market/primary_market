// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor() ERC20("TestToken", "TT") {
        _mint(msg.sender, 10000000 * 10e18);
    }
}
