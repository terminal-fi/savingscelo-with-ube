#!/usr/bin/env node
import { program } from "commander"
import fs from "fs"
import path from "path"
import {ContractKit, newKit} from "@celo/contractkit"
import { AddressValidation, newLedgerWalletWithSetup } from "@celo/wallet-ledger"
import TransportNodeHid from "@ledgerhq/hw-transport-node-hid"
import { toTransactionObject } from "@celo/connect"

import { bytecode as SavingsCELOWithUbeV1Bytecode } from "../../build/contracts/SavingsCELOWithUbeV1.json"
import { SavingsCELOAddressAlfajores } from "savingscelo"

process.on('unhandledRejection', (reason, _promise) => {
	// @ts-ignore
	console.error('Unhandled Rejection at:', reason.stack || reason)
	process.exit(0)
})

program
	.option("-n --network <name>", "Network to deploy to. Options: devchain, alfajores, baklava, mainnet", "devchain")
	.parse()

const networks: {[key: string]: string} = {
	"devchain": "http://127.0.0.1:7545",
	"alfajores": "https://alfajores-forno.celo-testnet.org",
	"baklava": "https://baklava-forno.celo-testnet.org",
	"mainnet": "https://forno.celo.org",
}

// Relative path to the deploy folder changes depending on if it is run directly or using ts-node.
const contractsPath = __filename.endsWith(".ts") ?
	__dirname :
	path.join(__dirname, "..", "..", "..", "src", "deploy")

function contractAddress(
	network: string,
	contractName: string) {
	const fpath = path.join(contractsPath, `${network}.${contractName}.addr.json`)
	if (!fs.existsSync(fpath)) {
		return null
	}
	const data = JSON.parse(fs.readFileSync(fpath).toString())
	return data.address
}

function storeContractAddress(
	network: string,
	contractName: string,
	contractAddress: string) {
	fs.writeFileSync(
		path.join(contractsPath, `${network}.${contractName}.addr.json`),
		JSON.stringify({address: contractAddress}))
}

async function readAddressOrDeployContract(
	kit: ContractKit,
	network: string,
	contractName: string,
	contractData: string) {

	let address = contractAddress(network, contractName)
	if (!address) {
		console.info("DEPLOYING:", contractName, "...")
		const receipt = await (await kit
			.sendTransaction({data: contractData}))
			.waitReceipt()
		address = receipt.contractAddress
		if (!address) {
			throw new Error("Contract address not found?")
		}
		storeContractAddress(network, contractName, address)
	}
	console.info("DEPLOYED:", contractName, "ADDRESS:", address)
	return address
}

async function main() {
	const opts = program.opts()
	const networkURL = networks[opts.network]
	if (!networkURL) {
		throw new Error(`Unsupported network: ${opts.network}`)
	}

	let wallet
	let accountAddr
	if (opts.network !== "devchain") {
		const transport = await TransportNodeHid.open('')
		wallet = await newLedgerWalletWithSetup(
			transport,
			[0],
			undefined,
			AddressValidation.never)
		accountAddr = wallet.getAccounts()[0]
	}
	const kit = newKit(networkURL, wallet)
	if (!accountAddr) {
		accountAddr = (await kit.web3.eth.personal.getAccounts())[0]
	}
	kit.defaultAccount = accountAddr

	const celoAddress = (await kit.contracts.getGoldToken()).address
	const ubeswapRouterAddress = "0xE3D8bd6Aed4F159bc8000a9cD47CffDb95F96121"
	let savingsCELOAddress
	switch (opts.network) {
	case "alfajores":
		savingsCELOAddress = SavingsCELOAddressAlfajores
		break
	case "mainnet":
		savingsCELOAddress = "0x2879BFD5e7c4EF331384E908aaA3Bd3014b703fA"
		break
	default:
		throw new Error(`unsupported network: ${opts.network}`)
	}

	await readAddressOrDeployContract(
		kit, opts.network,
		"SavingsCELOWithUbeV1",
		SavingsCELOWithUbeV1Bytecode +
		kit.web3.eth.abi.encodeParameters(
			['address', 'address', 'address'],
			[savingsCELOAddress, celoAddress, ubeswapRouterAddress]).slice(2)
	)
}

main()