import { CeloContract } from "@celo/contractkit"
import { toWei } from "web3-utils"
import { SavingsKit } from "savingscelo"
import { SavingsCELOWithUbeV1Instance } from "../../types/truffle-contracts"
import { ABI as routerABI, IUniswapV2Router } from "../../types/web3-v1-contracts/IUniswapV2Router"
import { initializeUbePool, testKit, setupSavingsCELOAndUbeswap, ubeDeadline } from "./setup"
import { Deposited } from "../../types/truffle-contracts/SavingsCELOWithUbeV1"
import { toTransactionObject } from "@celo/connect"
import BigNumber from "bignumber.js"

const SavingsCELOWithUbeV1 = artifacts.require("SavingsCELOWithUbeV1")

contract("SavingsCELOWithUbeV1", (accounts) => {
	let instance: SavingsCELOWithUbeV1Instance
	let router: IUniswapV2Router
	let savingsKit: SavingsKit

	before(async() => {
		const {routerAddress, savingsCELOAddress} = await setupSavingsCELOAndUbeswap(testKit, accounts[0])
		await initializeUbePool(testKit, accounts[0], routerAddress, savingsCELOAddress, 1000e18)
		const celoTokenAddress = await testKit.registry.addressFor(CeloContract.GoldToken)
		instance = await SavingsCELOWithUbeV1.new(savingsCELOAddress, celoTokenAddress, routerAddress)
		router = new testKit.web3.eth.Contract(routerABI, routerAddress) as unknown as IUniswapV2Router
		savingsKit = new SavingsKit(testKit, savingsCELOAddress)
	})

	it("deposit", async() => {
		const res = await instance.deposit({from: accounts[1], value: toWei('500', 'ether')})
		const eventDeposited = res.logs.pop() as Truffle.TransactionLog<Deposited>
		assert.equal(eventDeposited.event, "Deposited")
		assert.equal(eventDeposited.args.direct, true)
		console.info(`Deposited: ${eventDeposited.args.celoAmount} ${eventDeposited.args.savingsAmount}`)

		const goldToken = await testKit.contracts.getGoldToken()
		await savingsKit.deposit().sendAndWaitForReceipt(
			{from: accounts[1], value: toWei('500', 'ether')})
		const toTrade_sCELO = await savingsKit.contract.methods.celoToSavings(toWei('500', 'ether')).call()
		await toTransactionObject(testKit.connection,
			savingsKit.contract.methods.increaseAllowance(router.options.address, toTrade_sCELO))
			.sendAndWaitForReceipt({from: accounts[1]})
		await toTransactionObject(testKit.connection,
			router.methods.swapExactTokensForTokens(
				toTrade_sCELO, 0,
				[savingsKit.contractAddress, goldToken.address],
				accounts[1], ubeDeadline()))
			.sendAndWaitForReceipt({from: accounts[1]})

		// Ubeswap pool should now be a better option for depositing.
		const res2 = await instance.deposit({from: accounts[1], value: toWei('500', 'ether')})
		const eventDeposited2 = res2.logs.pop() as Truffle.TransactionLog<Deposited>
		assert.equal(eventDeposited2.event, "Deposited")
		assert.equal(eventDeposited2.args.direct, false)
		console.info(`Deposited: ${eventDeposited2.args.celoAmount} ${eventDeposited2.args.savingsAmount}`)
		const expected_sCELO = await savingsKit.contract.methods.celoToSavings(toWei('500', 'ether')).call()
		assert.equal(new BigNumber(eventDeposited2.args.savingsAmount.toString(10)).gt(expected_sCELO), true)
	})
})