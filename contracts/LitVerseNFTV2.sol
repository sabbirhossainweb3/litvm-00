// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "./LitVerseNFT.sol";
contract LitVerseNFTV2 is LitVerseNFT {
function version() external pure returns (uint256) {
return 2;
}
}
