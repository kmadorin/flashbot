var TradingBot = artifacts.require("./TradingBot.sol");
module.exports = function(deployer) {
	deployer.deploy(TradingBot);
};