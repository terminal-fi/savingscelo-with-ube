import { CeloContract } from "@celo/contractkit"
import { toTransactionObject } from "@celo/connect"
import BigNumber from "bignumber.js"
import { toWei } from "web3-utils"

import { SavingsCELOWithUbeV1Instance } from "../../types/truffle-contracts"
import { testKit, setupSavingsCELOAndUbeswap, ubeDeadline, addLiquidity } from "./utils"
import { newSavingsCELOWithUbeKit, SavingsCELOWithUbeKit } from "../savingscelo-with-ube"

const SavingsCELOWithUbeV1 = artifacts.require("SavingsCELOWithUbeV1")

contract("SavingsCELOWithUbeV1", (accounts) => {
	let instance: SavingsCELOWithUbeV1Instance
	let sKit: SavingsCELOWithUbeKit
	const from = accounts[1]

	beforeEach(async() => {
		const {routerAddress, savingsCELOAddress} = await setupSavingsCELOAndUbeswap(testKit, accounts[0])
		const celoTokenAddress = await testKit.registry.addressFor(CeloContract.GoldToken)
		instance = await SavingsCELOWithUbeV1.new(savingsCELOAddress, celoTokenAddress, routerAddress)
		sKit = await newSavingsCELOWithUbeKit(testKit, instance.address)
		// initialize savingsCELO.
		await sKit.savingsKit
			.deposit()
			.sendAndWaitForReceipt({from: accounts[0], value: toWei("1", "ether")})
	})

	const setupLiquidity = async (reserve_CELO: BigNumber, reserve_sCELO: BigNumber) => {
		const goldToken = await testKit.contracts.getGoldToken()
		await goldToken
			.increaseAllowance(sKit.router.options.address, reserve_CELO)
			.sendAndWaitForReceipt({from: from})
		await sKit.savingsKit
			.deposit()
			.sendAndWaitForReceipt({
				from: from,
				value: (await sKit.savingsKit.savingsToCELO(reserve_sCELO)).plus(1).toString(10),
			})
		await toTransactionObject(
			testKit.connection,
			sKit.savingsKit.contract.methods
			.increaseAllowance(sKit.router.options.address, reserve_sCELO.toString(10)))
			.sendAndWaitForReceipt({from: from})
		await toTransactionObject(
			testKit.connection,
			sKit.router.methods.addLiquidity(
				goldToken.address, sKit.savingsKit.contractAddress,
				reserve_CELO.toString(10), reserve_sCELO.toString(10),
				reserve_CELO.toString(10), reserve_sCELO.toString(10),
				from,
				ubeDeadline(),
			))
			.sendAndWaitForReceipt({from: accounts[1]})
		const reserves = await sKit.reserves()
		assert.isTrue(reserve_CELO.eq(reserves.reserve_CELO))
		assert.isTrue(reserve_sCELO.eq(reserves.reserve_sCELO))
		console.info(`Liquidity setup: ${reserve_CELO}, ${reserve_sCELO}`)
	}

	it("case 0", async () => {
		await setupLiquidity(
			new BigNumber(1e18),
			new BigNumber(1e18 * 65536),
		)
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"), 0, 1.05)
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"),
			await sKit.savingsKit.celoToSavings(toWei("1", "ether")),
			1.05)
		try {
			await addLiquidity(
				sKit, from,
				toWei("1", "ether"),
				(await sKit.savingsKit.celoToSavings(toWei("1", "ether"))).plus(1),
				1.05)
			assert.fail(`must have failed!`)
		} catch { }
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"),
			(await sKit.savingsKit.celoToSavings(toWei("1", "ether"))).minus(1),
			1.05)
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"),
			await sKit.savingsKit.celoToSavings(toWei("0.5", "ether")),
			1.05)
	})

	it("case 1", async () => {
		await setupLiquidity(
			new BigNumber("509283024364244884"),
			new BigNumber("32752522070346078080538"),
		)
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"), 0, 1.05)
		// messup SavingsCELO ratio so it is no longer perfectly divisible.
		await sKit.savingsKit
			.deposit()
			.sendAndWaitForReceipt({from: from, value: 17})
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"),
			await sKit.savingsKit.celoToSavings(toWei("0.5", "ether")),
			1.05)
	})

	it("case 3", async () => {
		// reserve ratio ~1.16
		await setupLiquidity(
			new BigNumber("509783004364244884"),
			new BigNumber("38752522070346078080538"),
		)

		try {
			await addLiquidity(
				sKit, from,
				toWei("1", "ether"), 0, 1.05)
			assert.fail("must have failed.")
		} catch {}
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"), 0, 1.16)
		// messup SavingsCELO ratio so it is no longer perfectly divisible.
		await sKit.savingsKit
			.deposit()
			.sendAndWaitForReceipt({from: from, value: 17})
		await addLiquidity(
			sKit, from,
			toWei("1", "ether"),
			await sKit.savingsKit.celoToSavings(toWei("0.5", "ether")),
			1.16)
	})
})
