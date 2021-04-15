import { ContractKit, newKit } from "@celo/contractkit"
import BigNumber from "bignumber.js"

import { bytecode as factoryBytecode } from "../../precompiled/UniswapV2Factory.json"
import { bytecode as routerBytecode } from "../../precompiled/UniswapV2Router02.json"
import { bytecode as savingsCELOBytecode } from "savingscelo/build/contracts/SavingsCELO.json"

import { SavingsCELOWithUbeKit } from "../savingscelo-with-ube"

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

export const ubeDeadline = () => {
	return Math.floor((new Date().getTime() / 1000) + 60)
}

export const addLiquidity = async (
	sKit: SavingsCELOWithUbeKit,
	from: string,
	amtV_CELO: BigNumber.Value,
	amtV_sCELO: BigNumber.Value,
	maxRatio: number) => {
	const amt_CELO = new BigNumber(amtV_CELO)
	const amt_sCELO = new BigNumber(amtV_sCELO)
	const balance_sCELO = await sKit.savingsKit.contract.methods.balanceOf(from).call()
	const extra_sCELO = amt_sCELO.minus(balance_sCELO)
	if (extra_sCELO.gt(0)) {
		const toDeposit = (await sKit.savingsKit.savingsToCELO(extra_sCELO)).plus(1)
		await sKit.savingsKit
			.deposit()
			.sendAndWaitForReceipt({from: from, value: toDeposit.toFixed(0)})
	}
	const approveTXs = await sKit.approveAddLiquidity(from, amt_CELO, amt_sCELO)
	for (const tx of approveTXs) {
		await tx.sendAndWaitForReceipt({from: from})
	}
	await sKit
		.addLiquidity(amt_CELO, amt_sCELO, maxRatio)
		.sendAndWaitForReceipt({from: from})

	const liquidity = await sKit.liquidityBalanceOf(from)
	console.info(
		`Liqudity: CELO: ${liquidity.balance_CELO.shiftedBy(-18)}, sCELO: ${liquidity.balance_sCELO.shiftedBy(-18)}, ` +
		`Ratio: ${await sKit.reserveRatio()}`)
}