var BigNumber = require('bignumber.js');
var accounts =  require('../accounts-config.js').accounts;

var PreIco = artifacts.require("./PreIco.sol");
var Token = artifacts.require("./Token.sol");

var manager = accounts[1];
var reserveManager = accounts[2];
var escrow = accounts[4];
var reserveEscrow = accounts[5];
var user = accounts[3];
var user2 = accounts[11];

const BASE = new BigNumber(1000000000000000000);

/* some thennable functions */
const promisify = (inner) =>
    new Promise((resolve, reject) =>
        inner((err, res) => {
            if (err) { reject(err) }
            resolve(res);
        })
    );
    
const getEmptyThen = () => promisify( cb => { cb(); } );
const getBalance = (account, at) =>
    promisify(cb => web3.eth.getBalance(account, at ? at : 'latest', cb));
const sendEthers = (options) => 
    promisify(cb => web3.eth.sendTransaction(options, cb));
const throwable = (thennable, reason) => 
    promisify(cb => {
        var throwMessage = "Throwable exception";
        return thennable
            .then(function () {
                assert(false, throwMessage);
            })
            .catch(function (err) {
                if (err && err.message === throwMessage) {
                    assert(false, (reason ? reason : 'Throwable object did not throw error'));
                }
                cb(null);
            });
    });
const getBlockNumber = () => web3.eth.getBlock('latest').number;
const getBlockTimestamp = () => web3.eth.getBlock('latest').timestamp;


function deployContracts(deadline) {
    var contracts = {};
    
    if (!deadline) {
        deadline = 0;
    }
    
    return PreIco.new(manager, reserveManager, escrow, reserveEscrow, deadline)
        .then(i => { contracts.ico = i; })
        .then(_ => Token.new(user))
        .then(t => { contracts.token = t; })
        .then(_ => contracts.ico.addToken(contracts.token.address, 10, 1, {from: reserveManager}))
        .then(_ => contracts);
}

contract('PreIco', function(_accounts) {
    it('should be OK with totalSupply', function () {
        var cnts;
        return deployContracts()
            .then(c => { cnts = c; })
            .then(_ => cnts.ico.totalSupply.call())
            .then(t => assert(t.equals(BASE.mul(950000))));
    });
    
    it('should be activated', function () {
        var cnts;
        return deployContracts()
            .then(c => { cnts = c; })
            .then(_ => cnts.ico.isIcoActive.call())
            .then(a => assert(a == true))
            .then(_ => cnts.ico.stopIco({from: manager}))
            .then(_ => cnts.ico.isIcoActive.call())
            .then(a => assert(a == false))
            .then(_ => cnts.ico.runIco({from: manager}))
            .then(_ => cnts.ico.isIcoActive.call())
            .then(a => assert(a == true));
    });
    
    it('should be deactivated', function () {
        return deployContracts(getBlockTimestamp() - 1000)
            .then(c => c.ico.isIcoActive.call())
            .then(a => assert(a == false));
    });
    
    it('should be addable and removable token; should be sell nice; should be returnable', function () {
        var cnts;
        return deployContracts()
            .then(c => { cnts = c; })
            .then(_ => throwable(cnts.ico.addToken(cnts.token.address, 5, 1), "Only manager can do it"))
            .then(_ => cnts.ico.addToken(cnts.token.address, 5, 1, {from: manager}))
            .then(_ => cnts.ico.removeToken(cnts.token.address, {from: manager}))
            .then(_ => cnts.token.approve(cnts.ico.address, 50, {from: user}))
            .then(_ => throwable(cnts.ico.buyWithTokensBy(user, cnts.token.address), "token is removed"))
            .then(_ => cnts.ico.addToken(cnts.token.address, 5, 1, {from: manager}))
            .then(_ => cnts.ico.buyWithTokensBy(user, cnts.token.address))
            .then(_ => cnts.ico.balanceOf.call(user))
            .then(b => assert(Number(b) == 10))
            .then(_ => cnts.ico.returnFundsFor(user, {from: manager}))
            .then(_ => cnts.token.balanceOf.call(user))
            .then(b => assert(b.equals(BASE.mul(100500))))
    });
    
    it('should be buying tokens by addTokensToReturn; should be returnable', function () {
        var cnts;
        return deployContracts()
            .then(c => { cnts = c; })
            .then(_ => cnts.token.transfer(cnts.ico.address, 100, {from: user}))
            .then(_ => cnts.token.balanceOf.call(user))
            .then(b => assert(b.equals(BASE.mul(100500).sub(100))))
            .then(_ => cnts.ico.addTokensToReturn(user, cnts.token.address, 100, true, {from: manager}))
            .then(_ => cnts.ico.balanceOf.call(user))
            .then(b => assert(Number(b) == 10))
            .then(_ => cnts.ico.returnFundsFor(user, {from: manager}))
            .then(_ => cnts.token.balanceOf.call(user))
            .then(b => assert(b.equals(BASE.mul(100500))))
    });
    
    it('should be buying tokens and withdrawal', function () {
        var cnts;
        var escrowBalance;
        return deployContracts()
            .then(c => {cnts = c})
            .then(_ => getBalance(escrow))
            .then(b => { escrowBalance = b; })
            .then(_ => cnts.token.approve(cnts.ico.address, 200, {from: user}))
            .then(_ => sendEthers({from: user, to: cnts.ico.address, value: 3, gas: 1000000}))
            .then(_ => cnts.ico.buyWithTokens(cnts.token.address, {from: user}))
            .then(_ => cnts.ico.balanceOf.call(user))
            .then(b => assert.equal(Number(b), 1020))
            .then(_ => throwable(cnts.ico.withdrawEther({from: manager})))
            .then(_ => sendEthers({from: user, to: cnts.ico.address, value: BASE.mul(500), gas: 1000000}))
            .then(_ => cnts.ico.withdrawEther({from: manager}))
            .then(_ => cnts.token.balanceOf.call(escrow))
            .then(b => assert.equal(Number(b), 200))
            .then(_ => getBalance(escrow))
            .then(b => assert(b.sub(escrowBalance).equals(BASE.mul(500).add(3))))
            .then(_ => sendEthers({from: escrow, to: user, value: BASE.mul(500).add(3)}))
    });
    
    it('should be buying tokens and withdrawal to reserve escrow', function () {
        var cnts;
        var escrowBalance;
        return deployContracts()
            .then(c => {cnts = c})
            .then(_ => getBalance(reserveEscrow))
            .then(b => { escrowBalance = b; })
            .then(_ => cnts.token.approve(cnts.ico.address, 200, {from: user}))
            .then(_ => sendEthers({from: user, to: cnts.ico.address, value: 3, gas: 1000000}))
            .then(_ => cnts.ico.buyWithTokens(cnts.token.address, {from: user}))
            .then(_ => cnts.ico.balanceOf.call(user))
            .then(b => assert.equal(Number(b), 1020))
            .then(_ => throwable(cnts.ico.withdrawEtherToReserveEscrow({from: manager})))
            .then(_ => sendEthers({from: user, to: cnts.ico.address, value: BASE.mul(500), gas: 1000000}))
            .then(_ => cnts.ico.withdrawEtherToReserveEscrow({from: manager}))
            .then(_ => cnts.token.balanceOf.call(reserveEscrow))
            .then(b => assert.equal(Number(b), 200))
            .then(_ => getBalance(reserveEscrow))
            .then(b => assert(b.sub(escrowBalance).equals(BASE.mul(500).add(3))))
            .then(_ => sendEthers({from: reserveEscrow, to: user, value: BASE.mul(500).add(3)}))
    });
    
    it('should give reward; should move tokens', function () {
        var cnts;
        return deployContracts()
            .then(c => { cnts = c; })
            .then(_ => cnts.ico.giveReward(user, 500, {from: manager}))
            .then(_ => cnts.ico.balanceOf.call(user))
            .then(b => assert.equal(Number(b), 500))
            .then(_ => throwable(cnts.ico.giveReward(user, BASE.mul(350000), {from: manager})), "too much")
            .then(_ => cnts.ico.moveIcoTokens(user, user2, 150, {from: manager}))
            .then(_ => cnts.ico.balanceOf.call(user))
            .then(b => assert.equal(Number(b), 350))
            .then(_ => cnts.ico.balanceOf.call(user2))
            .then(b => assert.equal(Number(b), 150))
            .then(_ => throwable(cnts.ico.moveIcoTokens(user, user2, 450, {from: manager}), "Too much to move"))
    });
    
    it('should be bought with many ethers', function () {
        var cnts;
        var amountOfEther = BASE.mul(600).add(1041667 * 3);
        var predictableResult = BASE.mul(200000).add(1000000000);
        
        return deployContracts()
            .then(c => { cnts = c; })
            .then(_ => sendEthers({from: user2, to: cnts.ico.address, value: amountOfEther, gas: 1000000}))
            .then(_ => cnts.ico.balanceOf.call(user2))
            .then(b => assert(b.equals(predictableResult)))
            .then(_ => cnts.ico.withdrawEther({from: manager}))
            .then(_ => sendEthers({from: escrow, to: user2, value: amountOfEther}))
    });
    
    it('should be bought with many tokens', function () {
        var cnts;
        var howMuchTokens = BASE.mul(2000000).add(10416670);
        var predictableResult = BASE.mul(200000).add(1000000);
        
        return deployContracts()
            .then(c => { cnts = c; })
            .then(_ => cnts.token.addTo(user, howMuchTokens))
            .then(_ => cnts.token.approve(cnts.ico.address, howMuchTokens, {from: user}))
            .then(_ => cnts.ico.buyWithTokens(cnts.token.address, {from: user}))
            .then(_ => cnts.ico.balanceOf.call(user))
            .then(b => assert(b.equals(predictableResult)))
    });
});
