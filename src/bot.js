require('dotenv').config()
require('console.table')
const express = require('express')
const path = require('path')
const player = require('play-sound')(opts = {})
const http = require('http')
const cors = require('cors')
const Web3 = require('web3')
const axios = require('axios')
const moment = require('moment-timezone')

// SERVER CONFIG
const PORT = process.env.PORT || 5000
const app = express();
const server = http.createServer(app).listen(PORT, () => console.log(`Listening on ${ PORT }`))
app.use(express.static(path.join(__dirname, 'public')))
app.use(cors({credentials: true, origin: '*'}))

// WEB3 CONFIG
const web3 = new Web3(process.env.RPC_URL)
web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY)

// const HDWalletProvider = require('@truffle/hdwallet-provider');
// const mnemonic = process.env.MNEMONIC;
// const web3 = new Web3(new HDWalletProvider(mnemonic, process.env.RPC_URL));

const ZRX_EXCHANGE_ADDRESS = '0x61935CbDd02287B511119DDb11Aeb42F1593b7Ef'
const ZRX_EXCHANGE_ABI = require('./abis/ZrxExchange');
const zrxExchangeContract = new web3.eth.Contract(ZRX_EXCHANGE_ABI, ZRX_EXCHANGE_ADDRESS)

const TRADER_ABI = require('./abis/Trader');
const TRADER_ADDRESS = process.env.CONTRACT_ADDRESS
const traderContract = new web3.eth.Contract(TRADER_ABI, TRADER_ADDRESS);
const FILL_ORDER_ABI = {"constant":false,"inputs":[{"components":[{"internalType":"address","name":"makerAddress","type":"address"},{"internalType":"address","name":"takerAddress","type":"address"},{"internalType":"address","name":"feeRecipientAddress","type":"address"},{"internalType":"address","name":"senderAddress","type":"address"},{"internalType":"uint256","name":"makerAssetAmount","type":"uint256"},{"internalType":"uint256","name":"takerAssetAmount","type":"uint256"},{"internalType":"uint256","name":"makerFee","type":"uint256"},{"internalType":"uint256","name":"takerFee","type":"uint256"},{"internalType":"uint256","name":"expirationTimeSeconds","type":"uint256"},{"internalType":"uint256","name":"salt","type":"uint256"},{"internalType":"bytes","name":"makerAssetData","type":"bytes"},{"internalType":"bytes","name":"takerAssetData","type":"bytes"},{"internalType":"bytes","name":"makerFeeAssetData","type":"bytes"},{"internalType":"bytes","name":"takerFeeAssetData","type":"bytes"}],"internalType":"struct LibOrder.Order","name":"order","type":"tuple"},{"internalType":"uint256","name":"takerAssetFillAmount","type":"uint256"},{"internalType":"bytes","name":"signature","type":"bytes"}],"name":"fillOrder","outputs":[{"components":[{"internalType":"uint256","name":"makerAssetFilledAmount","type":"uint256"},{"internalType":"uint256","name":"takerAssetFilledAmount","type":"uint256"},{"internalType":"uint256","name":"makerFeePaid","type":"uint256"},{"internalType":"uint256","name":"takerFeePaid","type":"uint256"},{"internalType":"uint256","name":"protocolFeePaid","type":"uint256"}],"internalType":"struct LibFillResults.FillResults","name":"fillResults","type":"tuple"}],"payable":true,"stateMutability":"payable","type":"function"}
// const FILL_ORDER_ABI = require('./abis/FillOrder');

// ASSET SYMBOLS
const DAI = 'DAI'
const WETH = 'WETH'
const USDC = 'USDC'


// ASSET ADDRESSES
const ASSET_ADDRESSES = {
	DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
	WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
	USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
}

// DISPLAY LOGIC
tokensWithDecimalPlaces = (amount, symbol) => {
	amount = amount.toString()
	switch (symbol) {
		case DAI: // 18 decimals
			return web3.utils.fromWei(amount, 'Ether')
		default:
			return web3.utils.fromWei(amount, 'Ether')
	}
}

const TOKEN_DISPLAY_DECIMALS = 2 // Show 2 decimal places
const displayTokens = (amount, symbol) => {
	let tokens
	tokens = tokensWithDecimalPlaces(amount, symbol)
	return (tokens)
}

// TRADING FUNCTIONS
async function fetchOneInchExchangeData(args) {
	const {fromToken, toToken, fromAddress, amount} = args;
	try {
		const res = await axios.get('https://api.1inch.exchange/v2.0/swap', {
			params: {
				fromTokenAddress: fromToken,
				toTokenAddress: toToken,
				fromAddress,
				amount,
				slippage: 0,
				disableEstimate: true,
			}
		});
		return res.data
	} catch (e) {
		// console.log(e);
		return null;
	}
}

// UTILITIES
const now = () => (moment().tz('America/Chicago').format())

const SOUND_FILE = './ding.mp3'
const playSound = () => {
	player.play(SOUND_FILE, function(err){
		if(err) {
			console.log("Error playing sound!")
		}
	})
}


// FORMATTERS
const toTokens = (tokenAmount, symbol) => {
	switch (symbol) {
		case DAI: // 18 decimals
			return web3.utils.toWei(tokenAmount, 'Ether')
		case WETH: // 18 decimals
			return web3.utils.toWei(tokenAmount, 'Ether')
		case USDC: // 6 decimals
			return web3.utils.fromWei(web3.utils.toWei(tokenAmount), 'Szabo')
	}
}


// CHECK TO SEE IF ORDER CAN BE ARBITRAGED
const checkedOrders = []
let profitableArbFound = false

async function checkArb(args) {
	const {zrxOrder, assetOrder} = args

	// Track order
	const tempOrderID = JSON.stringify(zrxOrder)

	// Skip if order checked
	if (checkedOrders.includes(tempOrderID)) {
		// console.log('Order already checked')
		return // Don't log
	}

	// Add to checked orders
	checkedOrders.push(tempOrderID)

	// Skip if Maker Fee
	if (zrxOrder.makerFee.toString() !== '0') {
		console.log('Order has maker fee')
		return
	}

	// Skip if Taker Fee
	if (zrxOrder.takerFee.toString() !== '0') {
		console.log('Order has taker fee')
		return
	}

	// This becomes the input amount
	const inputAssetAmount = zrxOrder.takerAssetAmount;

	// Build order tuple
	const orderTuple = [
		zrxOrder.makerAddress,
		zrxOrder.takerAddress,
		zrxOrder.feeRecipientAddress,
		zrxOrder.senderAddress,
		zrxOrder.makerAssetAmount,
		zrxOrder.takerAssetAmount,
		zrxOrder.makerFee,
		zrxOrder.takerFee,
		zrxOrder.expirationTimeSeconds,
		zrxOrder.salt,
		zrxOrder.makerAssetData,
		zrxOrder.takerAssetData,
		zrxOrder.makerFeeAssetData,
		zrxOrder.takerFeeAssetData
	]

	// Fetch order status
	const orderInfo = await zrxExchangeContract.methods.getOrderInfo(orderTuple).call()

	// Skip order if it's been partially filled
	if (orderInfo.orderTakerAssetFilledAmount.toString() !== '0') {
		console.log('Order partially filled')
		return
	}

	// Fetch 1inch.exchange Data
	const oneInchExchangeData = await fetchOneInchExchangeData({
		fromToken: ASSET_ADDRESSES[assetOrder[1]],
		toToken: ASSET_ADDRESSES[assetOrder[2]],
		fromAddress: process.env.CONTRACT_ADDRESS,
		destReceiver: process.env.CONTRACT_ADDRESS,
		amount: zrxOrder.makerAssetAmount
	});

	// const oneInchExchangeData = null;

	if (oneInchExchangeData) {
		// This becomes the outputAssetAmount
		const outputAssetAmount = oneInchExchangeData.toTokenAmount;

		// Calculate estimated gas cost
		let estimatedGasFee = process.env.ESTIMATED_GAS.toString() * web3.utils.toWei(process.env.GAS_PRICE.toString(), 'Gwei')
		// estimatedGasFee = web3.utils.fromWei(estimatedGasFee.toString(), 'Ether')

		// Calculate net profit
		let netProfit = outputAssetAmount - inputAssetAmount - estimatedGasFee
		netProfit = Math.floor(netProfit) // Round down

		// Determine if profitable
		const profitable = netProfit.toString() > '0'

		// If profitable, then stop looking and trade!
		if (profitable) {
			// Skip if another profitable arb has already been found
			if (profitableArbFound) {
				return
			}

			// Tell the app that a profitable arb has been found
			profitableArbFound = true

			// Log the arb
			console.table([{
				'Profitable?': profitable,
				'Asset Order': assetOrder.join(', '),
				'Exchange Order': 'ZRX, 1Split',
				'Input': displayTokens(inputAssetAmount, assetOrder[0]).padEnd(22, ' '),
				'Output': displayTokens(outputAssetAmount, assetOrder[0]).padEnd(22, ' '),
				'Profit': displayTokens(netProfit.toString(), assetOrder[0]).padEnd(22, ' '),
				'Timestamp': now(),
			}])

			// Play alert tone
			playSound()

			// Call arb contract
			try {
				await trade(assetOrder[0], ASSET_ADDRESSES[assetOrder[0]], ASSET_ADDRESSES[assetOrder[1]], zrxOrder, inputAssetAmount, oneInchExchangeData)
			} catch(e) {
				console.log(e);
			}
		}
	}
}

// TRADE EXECUTION
async function trade(flashTokenSymbol, flashTokenAddress, arbTokenAddress, orderJson, fillAmount, oneInchExchangeData) {
	const accounts = await web3.eth.getAccounts();
	const FLASH_AMOUNT = toTokens('10', flashTokenSymbol) // 10,000 WETH
	const FROM_TOKEN = flashTokenAddress // WETH
	const FROM_AMOUNT = fillAmount // '1000000'
	const TO_TOKEN = arbTokenAddress

	const orderTuple = [
		orderJson.makerAddress,
		orderJson.takerAddress,
		orderJson.feeRecipientAddress ,
		orderJson.senderAddress ,
		orderJson.makerAssetAmount ,
		orderJson.takerAssetAmount ,
		orderJson.makerFee ,
		orderJson.takerFee ,
		orderJson.expirationTimeSeconds ,
		orderJson.salt ,
		orderJson.makerAssetData ,
		orderJson.takerAssetData ,
		orderJson.makerFeeAssetData ,
		orderJson.takerFeeAssetData
	]

	// Format ZRX function call data
	const takerAssetFillAmount = FROM_AMOUNT
	const signature = orderJson.signature

	const data = web3.eth.abi.encodeFunctionCall(FILL_ORDER_ABI, [orderTuple, takerAssetFillAmount, signature])

	// const receipt = await traderContract.methods.zrxSwap(
	// 	FROM_TOKEN, // address flashToken,
	// 	FLASH_AMOUNT, // uint256 flashAmount,
	// 	data, // bytes calldata zrxData,
	// ).send({
	// 	from: accounts[0],
	// 	gas: process.env.GAS_LIMIT,
	// 	gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'Gwei')
	// });
	//
	// console.log('#####: receipt: ', receipt)

	traderContract.events.StartBalance().on('data', function(event) {
		console.log("###: StartBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.EndBalance().on('data', function(event) {
		console.log("###: EndBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.ZRXBeforeDAIBalance().on('data', function(event) {
		console.log("###: ZRXBeforeDAIBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.ZRXAfterDAIBalance().on('data', function(event) {
		console.log("###: ZRXAfterDAIBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.ZRXBeforeWETHBalance().on('data', function(event) {
		console.log("###: ZRXBeforeWETHBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.ZRXAfterWETHBalance().on('data', function(event) {
		console.log("###: ZRXAfterWETHBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.OneInchBeforeWETHBalance().on('data', function(event) {
		console.log("###: OneInchBeforeWETHBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.OneInchAfterWETHBalance().on('data', function(event) {
		console.log("###: OneInchAfterWETHBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.OneInchBeforeDAIBalance().on('data', function(event) {
		console.log("###: OneInchBeforeDAIBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.OneInchAfterDAIBalance().on('data', function(event) {
		console.log("###: OneInchAfterDAIBalance:", event.returnValues)
	}).on('error', console.error);


	traderContract.events.FlashTokenBeforeBalance().on('data', function(event) {
		console.log("###: FlashTokenBeforeBalance:", event.returnValues)
	}).on('error', console.error);

	traderContract.events.FlashTokenAfterBalance().on('data', function(event) {
		console.log("###: FlashTokenAfterBalance:", event.returnValues)
	}).on('error', console.error);

	// Perform Trade
	const receipt = await traderContract.methods.getFlashloan(
		FROM_TOKEN, // address flashToken,
		FLASH_AMOUNT, // uint256 flashAmount,
		TO_TOKEN, // address arbToken,
		data, // bytes calldata zrxData,
		oneInchExchangeData.tx.data, //bytes calldata oneInchData
	).send({
		from: accounts[0],
		gas: process.env.GAS_LIMIT,
		gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'Gwei')
	});

	console.log('#####: receipt: ', receipt)

}


// FETCH ORDERBOOK
// https://0x.org/docs/api#get-srav3orderbook
// Bids will be sorted in descending order by price
async function checkOrderBook(baseAssetSymbol, quoteAssetSymbol) {
	const baseAssetAddress = ASSET_ADDRESSES[baseAssetSymbol].substring(2, 42)
	const quoteAssetAddress = ASSET_ADDRESSES[quoteAssetSymbol].substring(2, 42)
	const zrxResponse = await axios.get(`https://api.0x.org/sra/v3/orderbook?baseAssetData=0xf47261b0000000000000000000000000${baseAssetAddress}&quoteAssetData=0xf47261b0000000000000000000000000${quoteAssetAddress}&perPage=1000`)
	const zrxData = zrxResponse.data

	const bids = zrxData.bids.records

	bids.forEach((o) => {
		checkArb({zrxOrder: o.order, assetOrder: [baseAssetSymbol, quoteAssetSymbol, baseAssetSymbol]}) // E.G. WETH, DAI, WETH
	})
}

// CHECK MARKETS
let checkingMarkets = false
async function checkMarkets() {
	if(checkingMarkets) {
		return
	}

	// Stop checking markets if already found
	if(profitableArbFound) {
		clearInterval(marketChecker)
	}

	console.log(`Fetching market data @ ${now()} ...\n`)
	checkingMarkets = true
	try {
		await checkOrderBook(WETH, DAI)
	} catch (error) {
		console.error(error)
		checkingMarkets = false
		return
	}

	checkingMarkets = false
}

// RUN APP
playSound()

// Check markets every n seconds
const POLLING_INTERVAL = process.env.POLLING_INTERVAL || 3000 // 3 seconds
const marketChecker = setInterval(async () => { await checkMarkets() }, POLLING_INTERVAL)