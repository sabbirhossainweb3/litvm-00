// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ReentrantMarketplaceReceiver {
    address public target;
    bytes public attackData;
    uint256 public attackValue;
    bool public reentryBlocked;
    uint256 public receiveCount;

    function configure(address _target, bytes calldata _data, uint256 _value) external {
        target = _target;
        attackData = _data;
        attackValue = _value;
    }

    receive() external payable {
        receiveCount++;
        (bool success, ) = target.call{value: attackValue}(attackData);
        reentryBlocked = !success;
    }
}
