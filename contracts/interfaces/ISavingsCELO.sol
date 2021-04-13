//SPDX-License-Identifier: MIT
pragma solidity 0.6.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISavingsCELO is IERC20 {
	function deposit() external payable returns (uint256);
	function savingsToCELO(uint256 savingsAmount) external view returns (uint256);
	function celoToSavings(uint256 celoAmount) external view returns (uint256);
}