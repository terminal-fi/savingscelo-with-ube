//SPDX-License-Identifier: MIT
pragma solidity 0.6.8;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/ISavingsCELO.sol";
import "./interfaces/IUniswapV2.sol";

// @title SavingsCELOWithUbeV1
// @notice This contract implements useful atomic wrappers to interact with the
// SavingsCELO and the Ubeswap CELO<->sCELO pool contracts. This contract doesn't hold
// any state or user funds, it only exists to implement helpful atomic wrappers.
// Contract itself is un-upgradable, but since it holds no state, it can be easily replaced or
// extended by a new version.
contract SavingsCELOWithUbeV1 {
	using SafeMath for uint256;

	/// @dev SavingsCELO contract,
	ISavingsCELO public savingsCELO;
	/// @dev Ubeswap Router contract.
	IUniswapV2Router public ubeRouter;
	/// @dev Ubeswap CELO<->sCELO pool contract.
	IUniswapV2Pair public ubePair;
	/// @dev Core GoldToken contract.
	IERC20 public CELO;

	/// @dev emitted when deposit succeeds.
	/// @param from address that initiated the deposit.
	/// @param celoAmount amount of CELO that was deposited.
	/// @param savingsAmount amount of sCELO that was returned in exchange.
	/// @param direct if True, then deposit was done through SavingsCELO contract directly.
	/// If false, deposit was completed through an Ubeswap trade.
	event Deposited(address indexed from, uint256 celoAmount, uint256 savingsAmount, bool direct);

	/// @dev emitted when user adds liquidity to the CELO<->sCELO Ubeswap pool.
	/// @param from address that added the liquidity.
	/// @param celoAmount amount of CELO that the user provided.
	/// @param savingsAmount amount of sCELO that the user provided.
	/// @param liquidity amount of Ubeswap Pool liquidity tokens returned to the user.
	event AddedLiquidity(address indexed from, uint256 celoAmount, uint256 savingsAmount, uint256 liquidity);

	constructor (
		address _savingsCELO,
		address _CELO,
		address _ubeRouter) public {
		savingsCELO = ISavingsCELO(_savingsCELO);
		CELO = IERC20(_CELO);

		ubeRouter = IUniswapV2Router(_ubeRouter);
		IUniswapV2Factory factory = IUniswapV2Factory(ubeRouter.factory());
		address _pair = factory.getPair(_savingsCELO, _CELO);
		if (_pair == address(0)) {
			_pair = factory.createPair(_savingsCELO, _CELO);
		}
		require(_pair != address(0), "Ubeswap pair must exist!");
		ubePair = IUniswapV2Pair(_pair);
	}

	/// @notice Converts CELO to sCELO tokens. Automatically chooses the best rate between
	/// a direct deposit in SavingsCELO contract or a trade in Ubeswap CELO<->sCELO pool.
	/// @return received_sCELO amount of sCELO tokens returned to the caller.
	function deposit() external payable returns (uint256 received_sCELO) {
		(uint256 reserve_CELO, uint256 reserve_sCELO) = ubeGetReserves();
		uint256 fromUbe_sCELO = (reserve_CELO == 0 || reserve_sCELO == 0) ? 0 :
			ubeGetAmountOut(msg.value, reserve_CELO, reserve_sCELO);
		uint256 fromDirect_sCELO = savingsCELO.celoToSavings(msg.value);

		bool direct;
		if (fromDirect_sCELO >= fromUbe_sCELO) {
			direct = true;
			received_sCELO = savingsCELO.deposit{value: msg.value}();
			assert(received_sCELO >= fromDirect_sCELO);
		} else {
			direct = false;
			address[] memory path = new address[](2);
			path[0] = address(CELO);
			path[1] = address(savingsCELO);
			require(
				CELO.approve(address(ubeRouter), msg.value),
				"CELO approve failed for ubeRouter!");
			received_sCELO = ubeRouter.swapExactTokensForTokens(
				msg.value, fromUbe_sCELO, path, address(this), block.timestamp)[1];
			assert(received_sCELO >= fromUbe_sCELO);
		}
		require(
			savingsCELO.transfer(msg.sender, received_sCELO),
			"sCELO transfer failed!");
		emit Deposited(msg.sender, msg.value, received_sCELO, direct);
		return received_sCELO;
	}

	/// @notice Adds liquidity in proportioned way to Ubeswap CELO<->sCELO pool. Will convert
	/// necessary amount of CELO to sCELO tokens before adding liquidity too.
	/// @param amount_CELO amount of CELO to take from caller.
	/// @param amount_sCELO amount of sCELO to take from caller.
	/// @param maxReserveRatio maximum allowed reserve ratio. maxReserveRatio is multiplied by 1e18 to
	/// represent a float value as an integer.
	/// @dev maxReserveRatio protects the caller from adding liquidity when pool is not balanced.
	/// @return addedLiquidity amount of Ubeswap pool liquidity tokens that got added and sent to the caller.
	function addLiquidity(
		uint256 amount_CELO,
		uint256 amount_sCELO,
		uint256 maxReserveRatio
	) external returns (uint256 addedLiquidity) {
		(uint256 _amount_CELO, uint256 _amount_sCELO) = (amount_CELO, amount_sCELO);
		uint256 toConvert_CELO = calculateToConvertCELO(amount_CELO, amount_sCELO, maxReserveRatio);
		uint256 converted_sCELO = 0;
		if (amount_CELO > 0) {
			require(
				CELO.transferFrom(msg.sender, address(this), amount_CELO),
				"CELO transferFrom failed!");
		}
		if (amount_sCELO > 0) {
			require(
				savingsCELO.transferFrom(msg.sender, address(this), amount_sCELO),
				"sCELO transferFrom failed!");
		}
		if (toConvert_CELO > 0) {
			converted_sCELO = savingsCELO.deposit{value: toConvert_CELO}();
			amount_sCELO = amount_sCELO.add(converted_sCELO);
			amount_CELO = amount_CELO.sub(toConvert_CELO);
		}
		if (amount_CELO > 0) {
			require(
				CELO.approve(address(ubeRouter), amount_CELO),
				"CELO approve failed for ubeRouter!");
		}
		if (amount_sCELO > 0) {
			require(
				savingsCELO.approve(address(ubeRouter), amount_sCELO),
				"sCELO approve failed for ubeRouter!");
		}
		// NOTE: amount_CELO might be few WEI more than needed, however there is no point
		// to try to return that back to the caller since GAS costs associated with dealing 1 or 2 WEI would be
		// multiple orders of magnitude more costly.
		(, , addedLiquidity) = ubeRouter.addLiquidity(
			address(CELO), address(savingsCELO),
			amount_CELO, amount_sCELO,
			amount_CELO.sub(5), amount_sCELO,
			msg.sender, block.timestamp);

		emit AddedLiquidity(msg.sender, _amount_CELO, _amount_sCELO, addedLiquidity);
		return (addedLiquidity);
	}

	/// @dev helper function to calculate amount of CELO that needs to be converted to sCELO
	/// to add liquidity in proportional way.
	function calculateToConvertCELO(
		uint256 amount_CELO,
		uint256 amount_sCELO,
		uint256 maxReserveRatio
	) internal view returns (uint256 toConvert_CELO) {
		(uint256 reserve_CELO, uint256 reserve_sCELO) = ubeGetReserves();
		if (reserve_CELO == 0 && reserve_sCELO == 0) {
			// If pool is empty, we can safely assume that the reserve ratio is just the ideal 1:1.
			reserve_CELO = 1;
			reserve_sCELO = savingsCELO.celoToSavings(1);
		}
		uint256 reserve_CELO_as_sCELO = savingsCELO.celoToSavings(reserve_CELO);
		// Reserve ratio is: max(reserve_sCELO/reserve_CELO_as_sCELO, reserve_CELO_as_sCELO/reserve_sCELO)
		// We perform comparisons without using division to keep things as safe and correct as possible.
		require(
			reserve_sCELO.mul(maxReserveRatio) >= reserve_CELO_as_sCELO.mul(1e18),
			"Too little sCELO in the liqudity pool. Adding liquidity is not safe!");
		require(
			reserve_CELO_as_sCELO.mul(maxReserveRatio) >= reserve_sCELO.mul(1e18),
			"Too little CELO in the liqudity pool. Adding liquidity is not safe!");

		// matched_CELO and amount_sCELO can be added proportionally.
		uint256 matched_CELO = amount_sCELO.mul(reserve_CELO).add(reserve_sCELO.sub(1)).div(reserve_sCELO);
		require(
			matched_CELO <= amount_CELO,
			"Too much sCELO. Can not add proportional liquidity!");
		// from rest of the CELO (i.e. amount_CELO-matched_CELO), we need to convert some amount to
		// sCELO to keep it proportion to reserve_CELO / reserve_sCELO.
		// NOTE: calculations and conversions are done in such a way that all sCELO will always be consumed
		// and rounding errors will apply to CELO itself. It is possible that we will have to throw out 1 or 2
		// WEI at most to meet the proportionality.
		toConvert_CELO = amount_CELO.sub(matched_CELO)
			.mul(reserve_sCELO)
			.div(reserve_sCELO.add(reserve_CELO_as_sCELO));
		// Prefer to under-convert, vs to over-convert. This way we make sure that all sCELO is always
		// consumed when we add liquidity and there can be only 1 or 2 celoWEI left over.
		return toConvert_CELO > 0 ? toConvert_CELO.sub(1) : 0;
	}

	/// @notice returns Ubeswap CELO<->sCELO pool reserves.
	/// @return reserve_CELO amount of CELO in the pool.
	/// @return reserve_sCELO amount of sCELO in the pool.
	function ubeGetReserves() public view returns (uint256 reserve_CELO, uint256 reserve_sCELO) {
		(uint256 reserve0, uint256 reserve1, ) = ubePair.getReserves();
		return (ubePair.token0() == address(CELO)) ? (reserve0, reserve1) : (reserve1, reserve0);
	}

	/// @dev copied from UniswapV2Library code.
	function ubeGetAmountOut(
		uint amountIn,
		uint reserveIn,
		uint reserveOut) internal pure returns (uint amountOut) {
		require(amountIn > 0, 'GetAmount: INSUFFICIENT_INPUT_AMOUNT');
		require(reserveIn > 0 && reserveOut > 0, 'GetAmount: INSUFFICIENT_LIQUIDITY');
		uint amountInWithFee = amountIn.mul(997);
		uint numerator = amountInWithFee.mul(reserveOut);
		uint denominator = reserveIn.mul(1000).add(amountInWithFee);
		amountOut = numerator / denominator;
	}
}
