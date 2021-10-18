import { ContractKit } from "@celo/contractkit";
import { SavingsKit } from "@terminal-fi/savingscelo";
import { SavingsCeloWithUbeV1, ABI } from "../types/web3-v1-contracts/SavingsCELOWithUbeV1"
import { IUniswapV2Router, ABI as routerABI } from "../types/web3-v1-contracts/IUniswapV2Router"
import { IUniswapV2Pair, ABI as pairABI } from "../types/web3-v1-contracts/IUniswapV2Pair"
import BigNumber from "bignumber.js";
import { CeloTransactionObject, toTransactionObject } from "@celo/connect";

const erc20InfiniteAmount = new BigNumber("0xff00000000000000000000000000000000000000000000000000000000000000")

export const newSavingsCELOWithUbeKit = async (kit: ContractKit, contractAddress: string) => {
	const contract = new kit.web3.eth.Contract(ABI, contractAddress) as unknown as SavingsCeloWithUbeV1
	const routerAddress = contract.methods.ubeRouter().call()
	const pairAddress = contract.methods.ubePair().call()
	const savingsAddress = await contract.methods.savingsCELO().call()
	const savingsKit = new SavingsKit(kit, savingsAddress)
	const routerContract = new kit.web3.eth.Contract(routerABI, await routerAddress) as unknown as IUniswapV2Router
	const pairContract = new kit.web3.eth.Contract(pairABI, await pairAddress) as unknown as IUniswapV2Pair
	return new SavingsCELOWithUbeKit(
		kit,
		contract,
		savingsKit,
		routerContract,
		pairContract,
	)
}

export class SavingsCELOWithUbeKit {
	constructor(
		public kit: ContractKit,
		public contract: SavingsCeloWithUbeV1,
		public savingsKit: SavingsKit,
		public router: IUniswapV2Router,
		public pair: IUniswapV2Pair) {
	}

	public reserves = async () => {
		const r = await this.contract.methods.ubeGetReserves().call()
		return {
			reserve_CELO: new BigNumber(r.reserve_CELO),
			reserve_sCELO: new BigNumber(r.reserve_sCELO),
		}
	}

	public reserveRatio = async () => {
		const {reserve_CELO, reserve_sCELO} = await this.reserves()
		if (reserve_CELO.eq(0) && reserve_sCELO.eq(0)) {
			return new BigNumber(1)
		}
		const reserve_sCELOasCELO = await this.savingsKit.savingsToCELO(reserve_sCELO)
		return BigNumber.maximum(
			reserve_CELO.div(reserve_sCELOasCELO),
			reserve_sCELOasCELO.div(reserve_CELO),
		)
	}

	public liquidityBalanceOf = async (address: string) => {
		const _liquidity = this.pair.methods.balanceOf(address).call()
		const _totalSupply = this.pair.methods.totalSupply().call()
		const {reserve_CELO, reserve_sCELO} = await this.reserves()
		const liquidity = new BigNumber(await _liquidity)
		const totalSupply = new BigNumber(await _totalSupply)
		const balance_CELO = liquidity.multipliedBy(reserve_CELO).div(totalSupply).integerValue()
		const balance_sCELO = liquidity.multipliedBy(reserve_sCELO).div(totalSupply).integerValue()
		return {
			liquidity,
			balance_CELO,
			balance_sCELO,
		}
	}

	public deposit = () => {
		return toTransactionObject(this.kit.connection, this.contract.methods.deposit())
	}

	public addLiquidity = (
		amount_CELO: BigNumber.Value,
		amount_sCELO: BigNumber.Value,
		maxReserveRatio: BigNumber.Value,
	) => {
		return toTransactionObject(
			this.kit.connection,
			this.contract.methods.addLiquidity(
				new BigNumber(amount_CELO).toString(10),
				new BigNumber(amount_sCELO).toString(10),
				new BigNumber(maxReserveRatio).shiftedBy(18).toString(10),
			),
		)
	}

	public approveAddLiquidity = async (
		from: string,
		amount_CELO: BigNumber.Value,
		amount_sCELO: BigNumber.Value,
		infinite?: boolean,
	) => {
		const goldToken = await this.kit.contracts.getGoldToken()
		const allowance_CELO = await goldToken.allowance(
			from, this.contract.options.address)
		const allowance_sCELO = new BigNumber(await this.savingsKit.contract.methods.allowance(
			from, this.contract.options.address).call())
		const txs: CeloTransactionObject<boolean>[] = []
		if (allowance_CELO.lt(amount_CELO)) {
			txs.push(
				goldToken.increaseAllowance(
					this.contract.options.address,
					!infinite ? amount_CELO : erc20InfiniteAmount))
		}
		if (allowance_sCELO.lt(amount_sCELO)) {
			txs.push(
				toTransactionObject(
					this.kit.connection,
					this.savingsKit.contract.methods.increaseAllowance(
						this.contract.options.address,
						(!infinite ? amount_sCELO : erc20InfiniteAmount).toString(10)))
				)
		}
		return txs
	}

	public approveRemoveLiquidity = async (
		from: string,
		amount_ULP: BigNumber.Value,
		infinite?: boolean,
	) => {
		const allowance_ULP = new BigNumber(await this.pair.methods.allowance(
			from, this.router.options.address).call())
		const txs: CeloTransactionObject<boolean>[] = []
		if (allowance_ULP.lt(amount_ULP)) {
			txs.push(
				toTransactionObject(
					this.kit.connection,
					this.pair.methods.approve(
						this.router.options.address,
						(!infinite ? amount_ULP : erc20InfiniteAmount).toString(10)))
				)
		}
		return txs
	}

	public removeLiquidity = async (
		amount_ULP: BigNumber.Value,
		minAmount_CELO: BigNumber.Value,
		minAmount_sCELO: BigNumber.Value,
		to: string,
		deadline: number | string,
	) => {
		const goldToken = await this.kit.contracts.getGoldToken()
		return toTransactionObject(
			this.kit.connection,
			this.router.methods.removeLiquidity(
				goldToken.address, this.savingsKit.contractAddress,
				amount_ULP.toString(10), minAmount_CELO.toString(10), minAmount_sCELO.toString(10),
				to, deadline
			))
	}

	// Minimum amount of CELO needed to complement amount_sCELO sCELO tokens to add liquidity.
	public minCELOtoAddLiquidity = async (amount_sCELO: BigNumber) => {
		const {reserve_CELO, reserve_sCELO} = await this.reserves()
		return amount_sCELO.multipliedBy(reserve_CELO).div(reserve_sCELO).integerValue(BigNumber.ROUND_UP)
	}
}

// Calculates maximum potential loss (or "impermanent loss") due to Ube price changes
// when providing liquidity at a particular starting reserveRatio.
//
// ratio = 1.01 => 0.000012376
// ratio = 1.05 => 0.000297486
// ratio = 1.10 => 0.00113443
export const maxLossFromPriceChange = (reserveRatio: BigNumber.Value) => {
	// Liquidity starts at: r0            , ratio * r0
	// Liquidity ends at:   ratio^0.5 * r0, ratio ^ 0.5 * r0
	//
	// maxLoss: ((r0 + ratio * r0) - 2 * ratio^0.5 * r0) / (r0 + ratio * r0)
	const r = new BigNumber(reserveRatio)
	return r.plus(1).minus(r.sqrt().multipliedBy(2)).div(r.plus(1))
}
