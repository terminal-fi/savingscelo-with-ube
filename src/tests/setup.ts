import { CeloContract, ContractKit, newKit } from "@celo/contractkit"
import BigNumber from "bignumber.js"
import { SavingsKit } from "savingscelo"

import { bytecode as factoryBytecode } from "../../precompiled/UniswapV2Factory.json"
import { bytecode as routerBytecode } from "../../precompiled/UniswapV2Router02.json"
import { bytecode as savingsCELOBytecode } from "savingscelo/build/contracts/SavingsCELO.json"

import { ABI as routerABI, IUniswapV2Router } from "../../types/web3-v1-contracts/IUniswapV2Router"
import { toTransactionObject } from "@celo/connect"

export const testKit = newKit("http://127.0.0.1:7545")
export const setupSavingsCELOAndUbeswap = async (kit: ContractKit, from: string) => {
	const factoryAddress = await deployContract(
		kit, from, "Ubeswap:Factory",
		factoryBytecode +
		kit.web3.eth.abi.encodeParameters(['address'], [from]).slice(2))
	const routerAddress = await deployContract(
		kit, from, "Ubeswap:Router",
		routerBytecode +
		kit.web3.eth.abi.encodeParameters(['address'], [factoryAddress]).slice(2))
	const savingsCELOAddress = await deployContract(
		kit, from, "SavingsCELO",
		savingsCELOBytecode)
	return {
		factoryAddress,
		routerAddress,
		savingsCELOAddress,
	}
}

async function deployContract(
	kit: ContractKit,
	from: string,
	contractName: string,
	contractData: string) {
	console.info("DEPLOYING:", contractName, "...")
	const receipt = await (await kit
		.sendTransaction({data: contractData, from: from}))
		.waitReceipt()
	console.info("DEPLOYED:", receipt.contractAddress)
	return receipt.contractAddress!
}

export const initializeUbePool = async (
	kit: ContractKit,
	from: string,
	routerAddress: string,
	savingsCELOAddress: string,
	initialAmt: BigNumber.Value) => {

	console.info("Initializing UbePool: CELO <-> sCELO...")
	const savingsKit = new SavingsKit(kit, savingsCELOAddress)
	const initialAmt_CELO = new BigNumber(initialAmt).div(2).toFixed(0)
	await savingsKit.deposit().sendAndWaitForReceipt({from: from, value: initialAmt_CELO})
	const initialAmt_sCELO = await savingsKit.contract.methods.balanceOf(from).call()

	const goldToken = await kit.contracts.getGoldToken()
	await goldToken
		.increaseAllowance(routerAddress, initialAmt_CELO)
		.sendAndWaitForReceipt({from: from})
	await toTransactionObject(kit.connection, savingsKit.contract.methods
		.increaseAllowance(routerAddress, initialAmt_sCELO))
		.sendAndWaitForReceipt({from: from})

	console.info(`Adding liquidity: CELO, sCELO: ${initialAmt_CELO}, ${initialAmt_sCELO}...`)
	const router = new kit.web3.eth.Contract(routerABI, routerAddress) as unknown as IUniswapV2Router
	const tx = router.methods.addLiquidity(
		goldToken.address, savingsCELOAddress,
		initialAmt_CELO, initialAmt_sCELO,
		initialAmt_CELO, initialAmt_sCELO,
		from,
		ubeDeadline(),
	)
	await toTransactionObject(kit.connection, tx).sendAndWaitForReceipt({from: from})
}

export const ubeDeadline = () => {
	return Math.floor((new Date().getTime() / 1000) + 60)
}