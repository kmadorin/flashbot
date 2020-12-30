# Flashbot

Flashbot is an arbitrage bot that fills 0x limit orders using DY/DX flash loans and 1inch.exchange

Based on 
[extropy.io defi bot](https://github.com/ExtropyIO/defi-bot)
But uses 1inch v2 API instead of 1inch v1 (OneSplit) smart contract

## How it works
1. Fetches 0x limit orders from Mesh network
2. Checks 1inch.exchange prices and finds if there is a profitable arbitrage opportunity 
3. If the opportunity was found Flashbot calls getFlashLoan function of TradingBot.sol smart contract which:
    * flash borrows 10 000 WETH from DY/DX
    * Fills 0x WETH/DAI order
    * Makes a swap on 1inch.exchange to get WETH for DAI from the previous step
    * Checks if arbitrage was profitable
    * If not profitable reverts transaction, if yes - pays borrowed WETH back to DY/DX
    
[Example output](https://github.com/kmadorin/flashbot/blob/master/output.txt)
## How to run and test
```
npm i
```

Fill in .env file like in .env.example

Create a local ethereum mainnet fork:

```
NODE_OPTIONS="--max-old-space-size=4096" ganache-cli --fork https://mainnet.infura.io/v3/<YOUR INFURA KEY> -p 8545 --gasLimit 0xfffffffffff -d --mnemonic "YOUR MNEMONIC HERE"
```

Compile and deploy FlashBot smart contract
```$xslt
truffle migrate
```

Run Flashbot

``` node ./src/bot.js```

## Future work

1. Add more flash loan protocols
2. Add a possibility to choose assets pairs for the arbitrage and choose the arbitrage strategy
3. Liquidation bot 
