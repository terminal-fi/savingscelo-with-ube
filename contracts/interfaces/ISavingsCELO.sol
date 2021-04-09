//SPDX-License-Identifier: MIT
pragma solidity 0.6.8;

interface ISavingsCELO {
	function deposit() external payable returns (uint256);

	/// Returns amount of CELO that can be claimed for savingsAmount SavingsCELO tokens.
	function savingsToCELO(uint256 savingsAmount) external view returns (uint256);
	/// Returns amount of SavingsCELO tokens that can be received for depositing celoAmount CELO tokens.
	function celoToSavings(uint256 celoAmount) external view returns (uint256);
}