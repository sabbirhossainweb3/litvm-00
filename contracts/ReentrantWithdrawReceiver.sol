
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ReentrantWithdrawReceiver {
    address public target;
    bool public reentryBlocked;
    uint256 public receiveCount;

    function setTarget(address _target) external {
        target = _target;
    }

    function attack() external {
        (bool success, ) = target.call(
            abi.encodeWithSignature("withdraw()")
        );
        require(success, "Initial withdrawal failed");
    }

    receive() external payable {
        receiveCount++;

        (bool success, ) = target.call(
            abi.encodeWithSignature("withdraw()")
        );

        reentryBlocked = !success;
    }
}
