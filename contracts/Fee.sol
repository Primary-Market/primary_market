// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MarketFee is Ownable2Step, EIP712 {
    using Math for uint256;

    mapping(address => mapping(address => uint256)) private _nonces;

    event Rebate(address, address, uint256);

    constructor() Ownable(msg.sender) EIP712("PMFee", "1") {}

    function nonceOf(
        address account,
        address token
    ) external view returns (uint256) {
        return _nonces[account][token];
    }

    function rebate(
        address token,
        uint256 number,
        uint256 nonce,
        bytes calldata signature
    ) public {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0 && balance >= number, "fee must more than zero");
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    keccak256(
                        "Rebate(address token,address to,uint256 number,uint256 nonce)"
                    ),
                    token,
                    msg.sender,
                    number,
                    nonce
                )
            )
        );
        require(
            _nonces[msg.sender][token] + 1 == nonce &&
                ECDSA.recover(digest, signature) == owner(),
            "must signed by owner"
        );
        _nonces[msg.sender][token]++;
        bool success = IERC20(token).transfer(msg.sender, number);
        require(success);
        emit Rebate(msg.sender, token, number);
    }
}
