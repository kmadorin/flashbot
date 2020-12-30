require('dotenv').config()
const Web3 = require('web3')
const axios = require('axios')

const HDWalletProvider = require('@truffle/hdwallet-provider');
const mnemonic = process.env.MNEMONIC;
const web3 = new Web3(new HDWalletProvider(mnemonic, process.env.RPC_URL));

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const WETH_ABI = require('./abis/WETH');
const WETHContract = new web3.eth.Contract(WETH_ABI, WETH_ADDRESS);

const DAI_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f';
const DAI_ABI = require('./abis/DAI');
const DAIContract = new web3.eth.Contract(DAI_ABI, DAI_ADDRESS);

const ZRX_EXCHANGE_ADDRESS = '0x61935CbDd02287B511119DDb11Aeb42F1593b7Ef';
const ZRX_ERC20_PROXY_ADDRESS = '0x95E6F48254609A6ee006F7D493c8e5fB97094ceF';
const ZRX_EXCHANGE_ABI = require('./abis/ZrxExchange');
const zrxExchangeContract = new web3.eth.Contract(ZRX_EXCHANGE_ABI, ZRX_EXCHANGE_ADDRESS)

const TRADER_ABI = require('./abis/Trader');
const TRADER_ADDRESS = process.env.CONTRACT_ADDRESS
const traderContract = new web3.eth.Contract(TRADER_ABI, TRADER_ADDRESS);
const FILL_ORDER_ABI = {
	"constant": false,
	"inputs": [{
		"components": [{
			"internalType": "address",
			"name": "makerAddress",
			"type": "address"
		}, {"internalType": "address", "name": "takerAddress", "type": "address"}, {
			"internalType": "address",
			"name": "feeRecipientAddress",
			"type": "address"
		}, {"internalType": "address", "name": "senderAddress", "type": "address"}, {
			"internalType": "uint256",
			"name": "makerAssetAmount",
			"type": "uint256"
		}, {"internalType": "uint256", "name": "takerAssetAmount", "type": "uint256"}, {
			"internalType": "uint256",
			"name": "makerFee",
			"type": "uint256"
		}, {"internalType": "uint256", "name": "takerFee", "type": "uint256"}, {
			"internalType": "uint256",
			"name": "expirationTimeSeconds",
			"type": "uint256"
		}, {"internalType": "uint256", "name": "salt", "type": "uint256"}, {
			"internalType": "bytes",
			"name": "makerAssetData",
			"type": "bytes"
		}, {"internalType": "bytes", "name": "takerAssetData", "type": "bytes"}, {
			"internalType": "bytes",
			"name": "makerFeeAssetData",
			"type": "bytes"
		}, {"internalType": "bytes", "name": "takerFeeAssetData", "type": "bytes"}],
		"internalType": "struct LibOrder.Order",
		"name": "order",
		"type": "tuple"
	}, {"internalType": "uint256", "name": "takerAssetFillAmount", "type": "uint256"}, {
		"internalType": "bytes",
		"name": "signature",
		"type": "bytes"
	}],
	"name": "fillOrder",
	"outputs": [{
		"components": [{
			"internalType": "uint256",
			"name": "makerAssetFilledAmount",
			"type": "uint256"
		}, {"internalType": "uint256", "name": "takerAssetFilledAmount", "type": "uint256"}, {
			"internalType": "uint256",
			"name": "makerFeePaid",
			"type": "uint256"
		}, {"internalType": "uint256", "name": "takerFeePaid", "type": "uint256"}, {
			"internalType": "uint256",
			"name": "protocolFeePaid",
			"type": "uint256"
		}], "internalType": "struct LibFillResults.FillResults", "name": "fillResults", "type": "tuple"
	}],
	"payable": true,
	"stateMutability": "payable",
	"type": "function"
}

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

async function checkOrder(zrxOrder) {
	// Skip if Maker Fee
	if (zrxOrder.makerFee.toString() !== '0') {
		return
	}

	// Skip if Taker Fee
	if (zrxOrder.takerFee.toString() !== '0') {
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
		return
	}

	return zrxOrder;
}

const asyncFilter = async (arr, predicate) => {
	const results = await Promise.all(arr.map(predicate));

	return arr.filter((_v, index) => results[index]);
}

async function fillOrder(orderJson) {
	const fillAmount = await depositWeth();
	const accounts = await web3.eth.getAccounts();

	const orderTuple = [
		orderJson.makerAddress,
		orderJson.takerAddress,
		orderJson.feeRecipientAddress,
		orderJson.senderAddress,
		orderJson.makerAssetAmount,
		orderJson.takerAssetAmount,
		orderJson.makerFee,
		orderJson.takerFee,
		orderJson.expirationTimeSeconds,
		orderJson.salt,
		orderJson.makerAssetData,
		orderJson.takerAssetData,
		orderJson.makerFeeAssetData,
		orderJson.takerFeeAssetData
	]

	const takerAssetFillAmount = fillAmount <= orderJson.takerAssetAmount ? fillAmount : orderJson.takerAssetAmount;
	const WETHBalance = await WETHContract.methods.balanceOf(accounts[0]).call();
	console.log('###: fillAmount', web3.utils.fromWei(fillAmount, 'Ether'));
	console.log('###: takerAssetFillAmount', web3.utils.fromWei(takerAssetFillAmount, 'Ether'));
	console.log('###: WETHBalance before', web3.utils.fromWei(WETHBalance, 'Ether'));
	const signature = orderJson.signature;
	console.log('###: signature', signature);

	const data = web3.eth.abi.encodeFunctionCall(FILL_ORDER_ABI, [orderTuple, takerAssetFillAmount, signature])

	const receipt = await traderContract.methods.zrxSwap(
		ASSET_ADDRESSES['WETH'], // address flashToken,
		takerAssetFillAmount, // uint256 flashAmount,
		data, // bytes calldata zrxData,
	).send({
		from: accounts[0],
		gas: process.env.GAS_LIMIT,
		gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'Gwei')
	});

	console.log('#####: receipt: ', receipt)

	const contractDAIBalance = await DAIContract.methods.balanceOf(process.env.CONTRACT_ADDRESS).call();
	console.log('###: contractDAIBalance', web3.utils.fromWei(contractDAIBalance, 'Ether'));

}


async function depositWeth() {
	// check WETH balance
	const accounts = await web3.eth.getAccounts();
	const WETHBalance = await WETHContract.methods.balanceOf(accounts[0]).call();

	if (WETHBalance == 0) {
		await WETHContract.methods.deposit().send({from: accounts[0], value: web3.utils.toWei('10', 'Ether')});
	}

	return await WETHContract.methods.balanceOf(accounts[0]).call();
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

	const filtered_bids = await asyncFilter(bids, async (bid) => {
		return checkOrder(bid.order, baseAssetSymbol, quoteAssetSymbol)
	});

	await fillOrder(filtered_bids[0].order);

	return filtered_bids
}

// checkOrderBook(WETH, DAI).then(orders => {
// 	// const order = orders[0];
// 	// console.log(order);
// });
const gasCosts = web3.utils.toWei((535330*20).toString(), 'Gwei');
console.log(web3.utils.fromWei(gasCosts, 'Ether'));
console.log(web3.utils.fromWei((60003428300278595777 - 60000000000000000000).toString(), 'Ether'));