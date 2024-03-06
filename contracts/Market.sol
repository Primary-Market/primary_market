// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Market is Ownable2Step, ReentrancyGuard, EIP712 {
    using Math for uint256;

    struct Ticket {
        uint256 number;
        uint256 fee;
        uint256 ts;
        address token;
        address seller;
        address locker;
    }
    enum TicketState {
        UNKNOWN,
        WAIT_LOCK,
        LOCKED,
        CANCEL_BY_LOCKER,
        UNLOCK_CANCELED,
        CANCELED,
        FINISH_BY_SELLER,
        FINISHED
    }
    mapping(uint256 => Ticket) _ticketInfo;
    mapping(IERC20 => bool) public tokenState;
    mapping(uint256 => TicketState) public ticketState;
    mapping(uint256 => bool) public allowance;
    mapping(uint256 => mapping(address => bool)) public ticketUnstakeEnd;
    mapping(address => bool) public allowedAddress;
    mapping(address => mapping(address => uint256)) private _nonces;
    uint256 public rate = 0;
    uint256 public rateBase = 100;
    address public fee;
    uint256 public timeDiff = 20 days;

    event TokenState(address, bool);
    event SetRate(uint256, uint256);
    event FeeChange(address);
    event TimeDiff(uint256);
    event NewTicket(address, address, uint256, uint256);
    event ReceiptFee(address, uint256, uint256);
    event LockTicket(address, address, uint256, uint256);
    event CancelTicket(address, uint256, TicketState);
    event FreeTicket(address, uint256, TicketState);
    event UnStake(address, address, uint256, uint256);
    event Approval(address, uint256);
    event RebasingAddress(address, bool);

    constructor(address _fee) Ownable(msg.sender) EIP712("PM", "1") {
        setFee(_fee);
    }

    function setTokenState(address token, bool state) public onlyOwner {
        tokenState[IERC20(token)] = state;
        emit TokenState(token, state);
    }

    function setAllowedAddress(address c, bool state) public onlyOwner {
        allowedAddress[c] = state;
        emit RebasingAddress(c, state);
    }

    function setFeeRate(uint256 _rate, uint256 _rateBase) public onlyOwner {
        require(
            _rate <= _rateBase && _rateBase > 0,
            "rate must less than base"
        );
        rate = _rate;
        rateBase = _rateBase;
        emit SetRate(_rate, _rateBase);
    }

    function setFee(address _fee) public onlyOwner {
        fee = _fee;
        emit FeeChange(fee);
    }

    function setTimeDiff(uint256 diff) public onlyOwner {
        timeDiff = diff;
        emit TimeDiff(diff);
    }

    function terminalTicket(uint256 ticketId) public onlyOwner {
        require(allowance[ticketId], "ticket id must be approve");
        require(
            ticketState[ticketId] == TicketState.FINISH_BY_SELLER,
            "ticket must finished by seller"
        );
        Ticket memory ticket = _ticketInfo[ticketId];
        ticketUnstakeEnd[ticketId][ticket.seller] = true;
        ticketState[ticketId] = TicketState.CANCELED;
    }

    function ticketFee(uint256 ticketId) public view returns (uint256) {
        require(
            ticketState[ticketId] != TicketState.UNKNOWN,
            "ticket id must exists"
        );
        Ticket memory ticket = _ticketInfo[ticketId];
        if (ticket.fee == 0) return ticket.number.mulDiv(rate, rateBase);
        else return ticket.fee;
    }

    function ticketInfo(
        uint256 ticketId
    ) public view returns (address, address, address, uint256, uint256) {
        require(
            ticketState[ticketId] != TicketState.UNKNOWN,
            "ticket id must exists"
        );
        Ticket memory ticket = _ticketInfo[ticketId];
        return (
            ticket.token,
            ticket.seller,
            ticket.locker,
            ticket.number,
            ticket.ts
        );
    }

    function nonceOf(address from, address c) external view returns (uint256) {
        return _nonces[from][c];
    }

    function newTicket(
        address token,
        uint256 ticketId,
        uint256 number,
        bytes calldata signature
    ) public {
        require(tokenState[IERC20(token)], "token should enable");
        require(
            ticketState[ticketId] == TicketState.UNKNOWN,
            "ticket id already exists"
        );
        require(
            IERC20(token).allowance(msg.sender, address(this)) >= number &&
                number > 0,
            "the allowance is insufficient to pay for this order"
        );
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    keccak256(
                        "NewTicket(address token,uint256 ticketId,uint256 number)"
                    ),
                    token,
                    ticketId,
                    number
                )
            )
        );
        require(
            ECDSA.recover(digest, signature) == owner(),
            "must signed by owner"
        );
        bool success = IERC20(token).transferFrom(
            msg.sender,
            address(this),
            number
        );
        require(success);
        _ticketInfo[ticketId] = Ticket(
            number,
            0,
            0,
            token,
            msg.sender,
            address(0)
        );
        ticketState[ticketId] = TicketState.WAIT_LOCK;
        emit NewTicket(msg.sender, token, ticketId, number);
    }

    function lockTicket(uint256 ticketId) public nonReentrant {
        require(
            ticketState[ticketId] == TicketState.WAIT_LOCK,
            "ticket id must exists"
        );
        Ticket memory ticket = _ticketInfo[ticketId];
        require(
            msg.sender != ticket.seller,
            "the locker must be different from the seller"
        );
        uint256 _fee = ticket.number.mulDiv(rate, rateBase);
        (bool success, uint256 act_number) = ticket.number.tryAdd(_fee);
        require(
            success &&
                IERC20(ticket.token).allowance(msg.sender, address(this)) >=
                act_number,
            "the allowance is insufficient to pay for this order"
        );
        success = IERC20(ticket.token).transferFrom(
            msg.sender,
            address(this),
            act_number
        );
        _ticketInfo[ticketId].locker = msg.sender;
        ticketState[ticketId] = TicketState.LOCKED;
        require(success);
        if (_fee > 0) _ticketInfo[ticketId].fee = _fee;
        emit LockTicket(msg.sender, ticket.token, ticketId, ticket.number);
    }

    function cancelTicket(uint256 ticketId) public {
        Ticket memory ticket = _ticketInfo[ticketId];
        if (ticket.locker == address(0)) {
            require(
                ticket.seller == msg.sender &&
                    ticketState[ticketId] == TicketState.WAIT_LOCK,
                "must called by the seller"
            );
            ticketState[ticketId] = TicketState.UNLOCK_CANCELED;
        } else {
            require(
                ticket.locker == msg.sender &&
                    ticketState[ticketId] == TicketState.LOCKED,
                "must called by the locker"
            );
            ticketState[ticketId] = TicketState.CANCEL_BY_LOCKER;
        }
        emit CancelTicket(msg.sender, ticketId, ticketState[ticketId]);
    }

    function approve(uint256 ticketId) public {
        Ticket memory ticket = _ticketInfo[ticketId];
        require(
            ticketState[ticketId] == TicketState.FINISH_BY_SELLER,
            "ticket state not finish by seller"
        );
        require(ticket.seller == msg.sender, "sender is not seller");
        require(
            ticket.ts > 0 && (block.timestamp - ticket.ts) >= timeDiff,
            "time has not come"
        );
        allowance[ticketId] = true;
        emit Approval(msg.sender, ticketId);
    }

    function freeTicket(uint256 ticketId) public {
        Ticket memory ticket = _ticketInfo[ticketId];
        if (ticketState[ticketId] == TicketState.CANCEL_BY_LOCKER) {
            require(
                ticket.seller == msg.sender,
                "must call by seller to finished cancel"
            );
            ticketState[ticketId] = TicketState.CANCELED;
        } else if (ticketState[ticketId] == TicketState.LOCKED) {
            require(ticket.seller == msg.sender, "must call by seller to ship");
            ticketState[ticketId] = TicketState.FINISH_BY_SELLER;
            _ticketInfo[ticketId].ts = block.timestamp;
        } else if (ticketState[ticketId] == TicketState.FINISH_BY_SELLER) {
            require(
                ticket.locker == msg.sender ||
                    (allowance[ticketId] && owner() == msg.sender),
                "must call by locker to finished"
            );
            ticketState[ticketId] = TicketState.FINISHED;
            if (ticket.fee > 0) {
                (bool success, uint256 _fee) = ticket.fee.tryMul(2);
                require(success);
                success = IERC20(ticket.token).transfer(fee, _fee);
                require(success);
                emit ReceiptFee(ticket.token, ticketId, _fee);
            }
        } else {
            require(false, "panic ticket state");
        }
        emit FreeTicket(msg.sender, ticketId, ticketState[ticketId]);
    }

    function unStake(uint256 ticketId) public nonReentrant {
        Ticket memory ticket = _ticketInfo[ticketId];
        uint256 number = 0;
        bool success = true;
        require(
            !ticketUnstakeEnd[ticketId][msg.sender],
            "user must allow unstake"
        );
        if (ticketState[ticketId] == TicketState.UNLOCK_CANCELED) {
            require(ticket.seller == msg.sender, "must called by the seller");
            number = ticket.number;
        } else if (ticketState[ticketId] == TicketState.CANCELED) {
            require(
                ticket.seller == msg.sender || ticket.locker == msg.sender,
                "parties to the transaction"
            );
            if (ticket.seller == msg.sender) number = ticket.number;
            else (success, number) = ticket.number.tryAdd(ticket.fee);
        } else if (ticketState[ticketId] == TicketState.FINISHED) {
            require(ticket.seller == msg.sender, "must called by the seller");
            (success, number) = ticket.number.trySub(ticket.fee);
            require(success);
            (success, number) = ticket.number.tryAdd(number);
        } else {
            require(false, "panic ticket state");
        }
        require(success);
        success = IERC20(ticket.token).transfer(msg.sender, number);
        require(success);
        ticketUnstakeEnd[ticketId][msg.sender] = true;
        emit UnStake(msg.sender, ticket.token, ticketId, number);
    }

    function iblast(
        address c,
        uint256 nonce,
        bytes calldata encode,
        bytes calldata signature
    ) public nonReentrant {
        require(allowedAddress[c], "contract address must be enable");
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    keccak256(
                        "IBlast(address from,address c,uint256 nonce,bytes encode)"
                    ),
                    msg.sender,
                    c,
                    nonce,
                    keccak256(encode)
                )
            )
        );
        require(
            _nonces[msg.sender][c] + 1 == nonce &&
                ECDSA.recover(digest, signature) == owner(),
            "must signed by owner"
        );
        _nonces[msg.sender][c]++;
        (bool success, ) = c.call(encode);
        require(success);
    }
}
