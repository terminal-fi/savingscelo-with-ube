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

export const ubeDeadline = () => {
	return Math.floor((new Date().getTime() / 1000) + 60)
}