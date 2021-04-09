//SPDX-License-Identifier: MIT
pragma solidity 0.6.8;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/ISavingsCELO.sol";
import "./interfaces/IUbeswapV2Router.sol";

contract SavingsCELOWithUbeV1 {
	using SafeMath for uint256;

	ISavingsCELO savingsCELO;
	IERC20 sCELO;
	IERC20 CELO;
	IUbeswapV2Router ubeRouter;

	event Deposited(address indexed from, uint256 celoAmount, uint256 savingsAmount, bool direct);

	constructor (
		address _savingsCELO,
		address _CELO,
		address _ubeRouter) public {
		savingsCELO = ISavingsCELO(_savingsCELO);
		sCELO = IERC20(_savingsCELO);
		CELO = IERC20(_CELO);
		ubeRouter = IUbeswapV2Router(_ubeRouter);
	}

	function deposit() external payable returns (uint256) {
		uint256 sCELOfromDirect = savingsCELO.celoToSavings(msg.value);
		address[] memory path = new address[](2);
		path[0] = address(CELO);
		path[1] = address(sCELO);
		uint256 sCELOfromUbe = ubeRouter.getAmountsOut(msg.value, path)[1];
		uint256 sCELOReceived;
		bool direct;
		if (sCELOfromDirect >= sCELOfromUbe) {
			direct = true;
			sCELOReceived = savingsCELO.deposit{value: msg.value}();
			assert(sCELOReceived >= sCELOfromDirect);
		} else {
			direct = false;
			sCELOReceived = ubeRouter.swapExactTokensForTokens(
				msg.value, sCELOfromUbe, path, address(this), block.timestamp)[1];
			assert(sCELOReceived >= sCELOfromUbe);
		}
		require(
			sCELO.transfer(msg.sender, sCELOReceived),
			"sCELO transfer failed!");
		emit Deposited(msg.sender, msg.value, sCELOReceived, direct);
		return sCELOReceived;
	}

	receive() external payable {}
}
