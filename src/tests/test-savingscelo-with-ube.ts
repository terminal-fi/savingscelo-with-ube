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

	const reserveRatio = async () => {
		const reserves = await instance.getUbeReserves()
		const reserve_sCELOasCELO = await savingsKit.contract.methods.savingsToCELO(reserves[1].toString()).call()
		return new BigNumber(reserves[0].toString()).div(reserve_sCELOasCELO)
	}

	const checkInstanceBalances = async () => {
		const goldToken = await testKit.contracts.getGoldToken()
		assert.isTrue((await goldToken.balanceOf(instance.address)).eq(0))
		assert.isTrue((await savingsKit.contract.methods.balanceOf(instance.address).call()) === "0")
	}

	before(async() => {
		const {routerAddress, savingsCELOAddress} = await setupSavingsCELOAndUbeswap(testKit, accounts[0])
		await initializeUbePool(testKit, accounts[0], routerAddress, savingsCELOAddress, toWei("2000", "ether"))
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
		console.info(
			`UBE reserve ratio: ${await reserveRatio()}, ` +
			`Deposited: ${eventDeposited.args.celoAmount} ${eventDeposited.args.savingsAmount}`)

		const goldToken = await testKit.contracts.getGoldToken()
		const toTrade_sCELO = await savingsKit.contract.methods.celoToSavings(toWei('500', 'ether')).call()
		await toTransactionObject(testKit.connection,
			savingsKit.contract.methods.increaseAllowance(router.options.address, toTrade_sCELO))
			.sendAndWaitForReceipt({from: accounts[1]})
		const beforeTradeCELO = await goldToken.balanceOf(accounts[1])
		await toTransactionObject(testKit.connection,
			router.methods.swapExactTokensForTokens(
				toTrade_sCELO, 0,
				[savingsKit.contractAddress, goldToken.address],
				accounts[1], ubeDeadline()))
			.sendAndWaitForReceipt({from: accounts[1]})
		const receivedCELO = (await goldToken.balanceOf(accounts[1])).minus(beforeTradeCELO)
		console.info(`UBE reserve ratio: ${await reserveRatio()}, received: ${receivedCELO}`)

		// Ubeswap pool should now be a better option for depositing.
		const res2 = await instance.deposit({from: accounts[1], value: receivedCELO.toString(10)})
		const eventDeposited2 = res2.logs.pop() as Truffle.TransactionLog<Deposited>
		assert.equal(eventDeposited2.event, "Deposited")
		assert.equal(eventDeposited2.args.direct, false)
		console.info(
			`UBE reserve ratio: ${await reserveRatio()}, ` +
			`Deposited: ${eventDeposited2.args.celoAmount} ${eventDeposited2.args.savingsAmount}`)
		const expected_sCELO = await savingsKit.contract.methods.celoToSavings(receivedCELO.toString(10)).call()
		assert.equal(new BigNumber(eventDeposited2.args.savingsAmount.toString(10)).gt(expected_sCELO), true)

		await checkInstanceBalances()
	})

	it("add liquidity", async () => {
		console.info(`UBE reserve ratio: ${await reserveRatio()}`)

		const goldToken = await testKit.contracts.getGoldToken()
		let toAdd_CELO = toWei("1000", "ether")
		await goldToken
			.increaseAllowance(instance.address, toAdd_CELO)
			.sendAndWaitForReceipt({from: accounts[2]})
		await instance.addLiquidity(
			toAdd_CELO,
			0,
			new BigNumber(1.005).shiftedBy(18).toString(10),
			{from: accounts[2]})
		console.info(`UBE reserve ratio: ${await reserveRatio()}`)

		toAdd_CELO = toWei("800", "ether")
		let toAdd_sCELOasCELO = toWei("200", "ether")
		await savingsKit.deposit()
			.sendAndWaitForReceipt({from: accounts[2], value: toAdd_sCELOasCELO})
		let toAdd_sCELO = await savingsKit.contract.methods.celoToSavings(toAdd_sCELOasCELO).call()
		await goldToken
			.increaseAllowance(instance.address, toAdd_CELO)
			.sendAndWaitForReceipt({from: accounts[2]})
		await toTransactionObject(testKit.connection,
			savingsKit.contract.methods.increaseAllowance(instance.address, toAdd_sCELO))
			.sendAndWaitForReceipt({from: accounts[2]})
		await instance.addLiquidity(
			toAdd_CELO,
			toAdd_sCELO,
			new BigNumber(1.005).shiftedBy(18).toString(10),
			{from: accounts[2]})
		console.info(`UBE reserve ratio: ${await reserveRatio()}`)

		toAdd_CELO = toWei("200", "ether")
		toAdd_sCELOasCELO = toWei("300", "ether")
		await savingsKit.deposit()
			.sendAndWaitForReceipt({from: accounts[2], value: toAdd_sCELOasCELO})
		toAdd_sCELO = await savingsKit.contract.methods.celoToSavings(toAdd_sCELOasCELO).call()
		await goldToken
			.increaseAllowance(instance.address, toAdd_CELO)
			.sendAndWaitForReceipt({from: accounts[2]})
		await toTransactionObject(testKit.connection,
			savingsKit.contract.methods.increaseAllowance(instance.address, toAdd_sCELO))
			.sendAndWaitForReceipt({from: accounts[2]})
		try {
			await instance.addLiquidity(
				toAdd_CELO,
				toAdd_sCELO,
				new BigNumber(1.005).shiftedBy(18).toString(10),
				{from: accounts[2]})
			assert.fail("addLiquidity must have failed!")
		} catch (e) {
			console.info(`addLiquidity failed as expected: ${e}`)
		}
		console.info(`UBE reserve ratio: ${await reserveRatio()}`)

		await checkInstanceBalances()
	})
})
