var TradingBot = artifacts.require("./TradingBot.sol");
module.exports = function(deployer, network, accounts) {
	deployer.deploy(TradingBot, {from: accounts[0], value: "50000000000000000000"});
};