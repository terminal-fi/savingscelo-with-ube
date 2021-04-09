//SPDX-License-Identifier: MIT
pragma solidity 0.6.8;

interface IUbeswapV2Router {
	function factory() external pure returns (address);

	function addLiquidity(
			address tokenA,
			address tokenB,
			uint amountADesired,
			uint amountBDesired,
			uint amountAMin,
			uint amountBMin,
			address to,
			uint deadline
	) external returns (uint amountA, uint amountB, uint liquidity);

	function swapExactTokensForTokens(
		uint amountIn,
		uint amountOutMin,
		address[] calldata path,
		address to,
		uint deadline
	) external returns (uint[] memory amounts);

	function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}
