import { ContractKit } from "@celo/contractkit";
import { SavingsKit } from "savingscelo";
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
	const isToken0_sCELO = (await pairContract.methods.token0().call()) === savingsAddress
	return new SavingsCELOWithUbeKit(
		kit,
		contract,
		savingsKit,
		routerContract,
		pairContract,
		isToken0_sCELO,
	)
}

export class SavingsCELOWithUbeKit {
	constructor(
		public kit: ContractKit,
		public contract: SavingsCeloWithUbeV1,
		public savingsKit: SavingsKit,
		public router: IUniswapV2Router,
		public pair: IUniswapV2Pair,
		public isToken0_sCELO: boolean) {
	}

	public reserves = async () => {
		const reserves = await this.pair.methods.getReserves().call()
		const [reserve_sCELO, reserve_CELO] = this.isToken0_sCELO ?
			[reserves.reserve0, reserves.reserve1] :
			[reserves.reserve1, reserves.reserve0]
		return {
			reserve_CELO: new BigNumber(reserve_CELO),
			reserve_sCELO: new BigNumber(reserve_sCELO),
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
					!infinite ? allowance_CELO.minus(amount_CELO).negated() : erc20InfiniteAmount))
		}
		if (allowance_sCELO.lt(amount_sCELO)) {
			txs.push(
				toTransactionObject(
					this.kit.connection,
					this.savingsKit.contract.methods.increaseAllowance(
						this.contract.options.address,
						(!infinite ? allowance_sCELO.minus(amount_sCELO).negated() : erc20InfiniteAmount).toString(10)))
				)
		}
		return txs
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
