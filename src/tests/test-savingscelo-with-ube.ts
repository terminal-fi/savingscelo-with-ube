import { CeloContract } from "@celo/contractkit"
import { toWei } from "web3-utils"
import { SavingsKit } from "savingscelo"
import { SavingsCELOWithUbeV1Instance } from "../../types/truffle-contracts"
import { ABI as routerABI, IUniswapV2Router } from "../../types/web3-v1-contracts/IUniswapV2Router"
import { testKit, setupSavingsCELOAndUbeswap, ubeDeadline } from "./setup"
import { Deposited } from "../../types/truffle-contracts/SavingsCELOWithUbeV1"
import { toTransactionObject } from "@celo/connect"
import BigNumber from "bignumber.js"
import { newSavingsCELOWithUbeKit, SavingsCELOWithUbeKit } from "../savingscelo-with-ube"

const SavingsCELOWithUbeV1 = artifacts.require("SavingsCELOWithUbeV1")

contract("SavingsCELOWithUbeV1", (accounts) => {
	const maxRatio = 1.05
	let instance: SavingsCELOWithUbeV1Instance
	let savingsUbeKit: SavingsCELOWithUbeKit

	const printInstanceBalances = async () => {
		const goldToken = await testKit.contracts.getGoldToken()
		console.info(`Balances: ` +
			`${await goldToken.balanceOf(instance.address)} ` +
			`${await savingsUbeKit.savingsKit.contract.methods.balanceOf(instance.address).call()}`)
	}

	before(async() => {
		const {routerAddress, savingsCELOAddress} = await setupSavingsCELOAndUbeswap(testKit, accounts[0])
		const celoTokenAddress = await testKit.registry.addressFor(CeloContract.GoldToken)
		instance = await SavingsCELOWithUbeV1.new(savingsCELOAddress, celoTokenAddress, routerAddress)
		savingsUbeKit = await newSavingsCELOWithUbeKit(testKit, instance.address)
	})

	it("deposit in empty pool", async() => {
		const res = await instance.deposit({from: accounts[1], value: toWei('500', 'ether')})
		const eventDeposited = res.logs.pop() as Truffle.TransactionLog<Deposited>
		assert.equal(eventDeposited.event, "Deposited")
		assert.equal(eventDeposited.args.direct, true)
	})

	it("add liquidity", async () => {
		const from = accounts[2]
		const goldToken = await testKit.contracts.getGoldToken()

		const addLiquidity = async (
			amtV_CELO: BigNumber.Value,
			amtV_sCELO: BigNumber.Value,
			maxRatio: number) => {
			const amt_CELO = new BigNumber(amtV_CELO)
			const amt_sCELO = new BigNumber(amtV_sCELO)
			const balance_sCELO = await savingsUbeKit.savingsKit.contract.methods.balanceOf(from).call()
			const extra_sCELO = amt_sCELO.minus(balance_sCELO)
			if (extra_sCELO.gt(0)) {
				const toDeposit = (await savingsUbeKit.savingsKit.savingsToCELO(extra_sCELO)).plus(1)
				await savingsUbeKit.savingsKit
					.deposit()
					.sendAndWaitForReceipt({from: from, value: toDeposit.toFixed(0)})
			}
			const approveTXs = await savingsUbeKit.approveAddLiquidity(from, amt_CELO, amt_sCELO)
			for (const tx of approveTXs) {
				await tx.sendAndWaitForReceipt({from: from})
			}
			await savingsUbeKit
				.addLiquidity(amt_CELO, amt_sCELO, maxRatio)
				.sendAndWaitForReceipt({from: from})

			const liquidity = await savingsUbeKit.liquidityBalanceOf(from)
			console.info(`Liqudity: CELO: ${liquidity.balance_CELO.shiftedBy(-18)}, ${liquidity.balance_sCELO.shiftedBy(-18)}`)
			console.info(`UBE reserve ratio: ${await savingsUbeKit.reserveRatio()}`)
		}

		await addLiquidity(
			toWei("1000", "ether"),
			0,
			maxRatio)
		await addLiquidity(
			toWei("800", "ether"),
			await savingsUbeKit.savingsKit.celoToSavings(toWei("200", "ether")),
			maxRatio)
		const toAdd_sCELO = await savingsUbeKit.savingsKit.celoToSavings(toWei("100", "ether"))
		const toAdd_CELO = await savingsUbeKit.minCELOtoAddLiquidity(toAdd_sCELO)
		try {
			await addLiquidity(
				toAdd_CELO.minus(1),
				toAdd_sCELO,
				maxRatio)
			assert.fail("addLiquidity must have failed!")
		} catch (e) {
			console.info(`addLiquidity failed as expected: ${e}`)
		}
		await addLiquidity(toAdd_CELO, toAdd_sCELO, maxRatio)
		await addLiquidity(toAdd_CELO, toAdd_sCELO.minus(1), maxRatio)

		// Disturb reserve ratio a bit.
		const toTrade_CELO = toWei("5", "ether")
		await goldToken
			.increaseAllowance(savingsUbeKit.router.options.address, toTrade_CELO)
			.sendAndWaitForReceipt({from: from})
		await toTransactionObject(testKit.connection,
			savingsUbeKit.router.methods.swapExactTokensForTokens(
				toTrade_CELO, 0,
				[goldToken.address, savingsUbeKit.savingsKit.contractAddress],
				from, ubeDeadline()))
			.sendAndWaitForReceipt({from: from})
		console.info(`UBE reserve ratio: ${await savingsUbeKit.reserveRatio()}`)
		await addLiquidity(
			toWei("10", "ether"),
			(await savingsUbeKit.savingsKit.celoToSavings(toWei("9", "ether"))).plus(1),
			maxRatio)

		await printInstanceBalances()
	})

	it("non-direct deposit", async() => {
		const goldToken = await testKit.contracts.getGoldToken()
		const toTrade_sCELO = await savingsUbeKit.savingsKit.celoToSavings(toWei('500', 'ether'))
		await toTransactionObject(testKit.connection,
			savingsUbeKit.savingsKit.contract.methods
			.increaseAllowance(savingsUbeKit.router.options.address, toTrade_sCELO.toString(10)))
			.sendAndWaitForReceipt({from: accounts[1]})
		const beforeTradeCELO = await goldToken.balanceOf(accounts[1])
		await toTransactionObject(testKit.connection,
			savingsUbeKit.router.methods.swapExactTokensForTokens(
				toTrade_sCELO.toString(10), 0,
				[savingsUbeKit.savingsKit.contractAddress, goldToken.address],
				accounts[1], ubeDeadline()))
			.sendAndWaitForReceipt({from: accounts[1]})
		const receivedCELO = (await goldToken.balanceOf(accounts[1])).minus(beforeTradeCELO)
		console.info(`UBE reserve ratio: ${await savingsUbeKit.reserveRatio()}, received: ${receivedCELO}`)

		// Ubeswap pool should now be a better option for depositing.
		const res = await instance.deposit({from: accounts[1], value: receivedCELO.toString(10)})
		const eventDeposited = res.logs.pop() as Truffle.TransactionLog<Deposited>
		assert.equal(eventDeposited.event, "Deposited")
		assert.equal(eventDeposited.args.direct, false)
		console.info(
			`UBE reserve ratio: ${await savingsUbeKit.reserveRatio()}, ` +
			`Deposited: ${eventDeposited.args.celoAmount} ${eventDeposited.args.savingsAmount}`)
		const expected_sCELO = await savingsUbeKit.savingsKit.celoToSavings(receivedCELO)
		assert.equal(expected_sCELO.lte(eventDeposited.args.savingsAmount.toString(10)), true)

		await printInstanceBalances()
	})
})
