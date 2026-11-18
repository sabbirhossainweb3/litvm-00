// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ReentrantNFTWithdrawReceiver {
    address public target;
    bool public reentryBlocked;
    uint256 public receiveCount;

    function attack(address nft) external {
        target = nft;

        (bool success,) = nft.call(
            abi.encodeWithSignature(
                "withdraw(address)",
                payable(address(this))
            )
        );

        require(success, "Initial withdrawal failed");
    }

    receive() external payable {
        receiveCount++;

        (bool success,) = target.call(
            abi.encodeWithSignature(
                "withdraw(address)",
                payable(address(this))
            )
        );

        reentryBlocked = !success;
    }
}