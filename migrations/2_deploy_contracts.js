var fs = require('fs');
var PreIco = artifacts.require('./PreIco.sol');

module.exports = function(deployer) {
    var abiString = JSON.stringify(PreIco.abi);
    fs.writeFileSync("./abi.txt", abiString);
};
