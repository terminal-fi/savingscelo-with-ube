import { toTransactionObject } from "@celo/connect"
import { CeloContract } from "@celo/contractkit"
import { toWei } from "web3-utils"

import { SavingsCELOWithUbeV1Instance } from "../../types/truffle-contracts"
import { Deposited } from "../../types/truffle-contracts/SavingsCELOWithUbeV1"
import { testKit, setupSavingsCELOAndUbeswap, ubeDeadline, addLiquidity } from "./utils"
import { newSavingsCELOWithUbeKit, SavingsCELOWithUbeKit } from "../savingscelo-with-ube"

const SavingsCELOWithUbeV1 = artifacts.require("SavingsCELOWithUbeV1")

contract("SavingsCELOWithUbeV1", (accounts) => {
	let instance: SavingsCELOWithUbeV1Instance
	let sKit: SavingsCELOWithUbeKit
	const from = accounts[1]

	before(async() => {
		const {routerAddress, savingsCELOAddress} = await setupSavingsCELOAndUbeswap(testKit, accounts[0])
		const celoTokenAddress = await testKit.registry.addressFor(CeloContract.GoldToken)
		instance = await SavingsCELOWithUbeV1.new(savingsCELOAddress, celoTokenAddress, routerAddress)
		sKit = await newSavingsCELOWithUbeKit(testKit, instance.address)
	})

	it("deposit in empty pool", async() => {
		const res = await instance.deposit({from: from, value: toWei('500', 'ether')})
		const eventDeposited = res.logs.pop() as Truffle.TransactionLog<Deposited>
		assert.equal(eventDeposited.event, "Deposited")
		assert.equal(eventDeposited.args.direct, true)
	})

	it("non-direct deposit", async() => {
		await addLiquidity(
			sKit, from,
			toWei("2000", "ether"), 0, 1.05)

		const goldToken = await testKit.contracts.getGoldToken()
		const toTrade_sCELO = await sKit.savingsKit.celoToSavings(toWei('500', 'ether'))
		await toTransactionObject(testKit.connection,
			sKit.savingsKit.contract.methods
			.increaseAllowance(sKit.router.options.address, toTrade_sCELO.toString(10)))
			.sendAndWaitForReceipt({from: accounts[1]})
		const beforeTradeCELO = await goldToken.balanceOf(accounts[1])
		await toTransactionObject(testKit.connection,
			sKit.router.methods.swapExactTokensForTokens(
				toTrade_sCELO.toString(10), 0,
				[sKit.savingsKit.contractAddress, goldToken.address],
				accounts[1], ubeDeadline()))
			.sendAndWaitForReceipt({from: accounts[1]})
		const receivedCELO = (await goldToken.balanceOf(accounts[1])).minus(beforeTradeCELO)
		console.info(`UBE reserve ratio: ${await sKit.reserveRatio()}, received: ${receivedCELO}`)

		// Ubeswap pool should now be a better option for depositing.
		const res = await instance.deposit({from: accounts[1], value: receivedCELO.toString(10)})
		const eventDeposited = res.logs.pop() as Truffle.TransactionLog<Deposited>
		assert.equal(eventDeposited.event, "Deposited")
		assert.equal(eventDeposited.args.direct, false)
		console.info(
			`UBE reserve ratio: ${await sKit.reserveRatio()}, ` +
			`Deposited: ${eventDeposited.args.celoAmount} ${eventDeposited.args.savingsAmount}`)
		const expected_sCELO = await sKit.savingsKit.celoToSavings(receivedCELO)
		assert.equal(expected_sCELO.lte(eventDeposited.args.savingsAmount.toString(10)), true)
	})
})
