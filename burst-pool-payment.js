var poolConfig = require('./burst-pool-config');
var poolShare   = require('./burst-pool-share');
var poolProtocol = require('./burst-pool-protocol');
var poolSession  = require('./burst-pool-session');
var async       = require('async');
var fs              = require('fs');
var jsonFormat      = require('prettyjson');

var blockPaymentList = [];
var pendingPaymentList = {};
var sentPaymentList = [];

function satoshiToDecimal(sat){
    if(typeof sat === 'undefined' || isNaN(sat)){
        return 0.0;
    }
    return parseFloat(sat)/100000000.0;
}

function decimalToSatoshi(amount){
    if(typeof amount === 'undefined' || isNaN(amount)){
        return 0;
    }
    return parseInt(parseFloat(amount)*100000000);
}

BlockPayment = function(height, shareList){
    this.shareList  = shareList; //{accountId, share}
    this.height     = height;
    this.totalShare = 0;
    this.allocatedFund  = 0;

    for(var i in this.shareList){
        this.totalShare += this.shareList[i].share;
    }
};

function assignCumulativeFund(height, amount){
    try{
        var fundedList = [];
        var totalScale = 0;
        //calculate funds allocation weight each block by applying cumulative reduction factor
        blockPaymentList.forEach(function(payBlock){
            var reduction = poolConfig.cumulativeFundReduction;
            if(reduction > 1.0){
                reduction = 1.0;
            }
            else if(reduction <= 0.0){
                reduction = 0.01;
            }
            if(payBlock.height <= height){
                var fundedItem = {
                    blockPayment : payBlock, //is this reference ??
                    scale : Math.pow(reduction,height-payBlock.height)
                };
                totalScale += fundedItem.scale;
                fundedList.push(fundedItem);
            }
        });

        if(totalScale > 0){
            //apply fund allocation weight to each block
            fundedList.forEach(function(fundedItem){
                fundedItem.blockPayment.allocatedFund += (amount * fundedItem.scale) / totalScale;
                poolProtocol.clientLog('Payment Block#'+fundedItem.blockPayment.height+' allocated fund = '+fundedItem.blockPayment.allocatedFund.toFixed(2));
            });
        }
    }
    catch(e){
        console.log(e);
        console.trace();
    }
}

function distributeShareToPayment(){
    var accountList = {};
    blockPaymentList.forEach(function(blockPayment){
        //calculate payment amount for each account
        blockPayment.shareList.forEach(function(shareItem){
            var amount = 0;
            if(blockPayment.totalShare > 0){
                amount = (shareItem.share*blockPayment.allocatedFund) / blockPayment.totalShare;
            }

            if(!pendingPaymentList.hasOwnProperty(shareItem.accountId)){
                pendingPaymentList[shareItem.accountId] = 0;
            }
            pendingPaymentList[shareItem.accountId] += amount;
            accountList[shareItem.accountId] = 1;
        });
    });

    for(var accountId in accountList){
        poolShare.deleteAccountShare(accountId);
    }

    blockPaymentList = [];
}

function flushPaymentList(done){
    try{
        var paymentItems = {};
        //calculate txFee
        for(var payAccountId in pendingPaymentList){
            if(!paymentItems.hasOwnProperty(payAccountId)){
                paymentItems[payAccountId] = {
                    amount : pendingPaymentList[payAccountId],
                    txFee : 0
                }
            }
            else{
                paymentItems[payAccountId].amount += paymentItems[payAccountId.txFee];
            }

            paymentItems[payAccountId].txFee = paymentItems[payAccountId].amount * poolConfig.txFeePercent;
            var txFee = Math.floor(paymentItems[payAccountId].txFee);
            if(txFee <= 0){
                txFee = 1.0;
            }
            paymentItems[payAccountId].txFee = txFee;
            paymentItems[payAccountId].amount = paymentItems[payAccountId].amount - paymentItems[payAccountId].txFee;
        }

        //clear blockpayment list, all data has been moved to paymentItems
        pendingPaymentList = {};

        //send payment for each pending item
        var accountList = [];
        for(var accountId in paymentItems){
            var paymentData = {
                accountId : accountId,
                amount : paymentItems[accountId].amount,
                txFee : paymentItems[accountId].txFee
            };
            accountList.push(paymentData);
        }

        //----- DEBUG ONLY
        //var pendingTxData = JSON.stringify(accountList, null, 4);
        //fs.writeFile('last-pay-calc.json',pendingTxData, function(err){});
        //----------

        var minPayout = poolConfig.minimumPayout;
        if( (poolSession.getCurrentBlockHeight() % 100) == 0){
            minPayout = poolConfig.clearingMinPayout;
        }

        var failedTxList = [];
        async.each(accountList,
            function(pay,callback){
                if(pay.amount > minPayout){
                    sendPayment(pay.accountId, pay.amount, pay.txFee, failedTxList, sentPaymentList, function(){
                    });
                }
                else{
                    //console.log(pay.accountId+' payment amount '+pay.amount+' is below payment threshold');
                    failedTxList.push(pay);
                }
                callback();
            },
            function(err){
                failedTxList.forEach(function(tx){
                    pendingPaymentList[tx.accountId] = tx.amount + tx.txFee;
                    //console.log('storing pending payment data for '+tx.accountId);
                });
                console.log('saving payment data..');
                saveSessionAsync(function(err){
                    console.log('payment data saved.');
                    poolProtocol.getWebsocket().emit('sentList',JSON.stringify(sentPaymentList));
                    done();
                });
            }
        );
    }
    catch(e){
        console.log(e);
        console.trace();
    }
}

function sendPayment(toAccountId, amount, txFee, failedTxList, sentPaymentList, done){
    var floatAmount = amount.toFixed(2);
    if(poolConfig.enablePayment === true){
        poolProtocol.httpPostForm('sendMoney',
            {
                recipient   : toAccountId,
                deadline    : poolConfig.defaultPaymentDeadline,
                feeNQT      : decimalToSatoshi(txFee),
                amountNQT   : decimalToSatoshi(amount),
                secretPhrase: poolConfig.poolPvtKey
            },
            function(error, res, body){

                var result = {
                    status    : false,
                    txid      : '',
                    sendTime  : 0,
                    accountId : toAccountId,
                    amount    : amount,
                    txFee     : txFee
                };

                if (!error && res.statusCode == 200) {
                    var response = JSON.parse(body);
                    if(response.hasOwnProperty('transaction')){
                        result.status = true;
                        result.txid = response.transaction;
                        result.sendTime = new Date().getTime();

                        poolProtocol.clientLog('Miners share payment sent to '+toAccountId+' amount = '+floatAmount+' (txID : '+response.transaction+' )');
                        console.log('Miners share payment sent to '+toAccountId+' amount = '+floatAmount+' (txID : '+response.transaction+' )');
                        sentPaymentList.push(result);
                        if(sentPaymentList.length > poolConfig.maxRecentPaymentHistory){
                            var toRemove = sentPaymentList.length - poolConfig.maxRecentPaymentHistory;
                            sentPaymentList.splice(0,toRemove);
                        }
                        poolSession.getState().current.totalPayments += amount;
                    }
                }
                else{
                    console.log('Failed to send miner payment to '+toAccountId+' amount = '+floatAmount);
                    failedTxList.push(result);
                }
                done();
            }
        );
        console.log('submitted transaction request, miner payment for  '+toAccountId+' amount = '+floatAmount);
    }
    else {
        done();
    }
}

function getPoolBalance(done){
    poolProtocol.httpPostForm('getGuaranteedBalance',
        {
            account:poolConfig.poolPublic,
            numberOfConfirmations:poolConfig.blockMature
        },
        function(error, res, body){
            if (!error && res.statusCode == 200) {
                var response = JSON.parse(body);
                if(response.hasOwnProperty('guaranteedBalanceNQT')){
                    var balanceResult = parseFloat(response.guaranteedBalanceNQT)/100000000.0;
                    var result = {
                        status : true,
                        balance : balanceResult
                    };
                    console.log('Pool Balance = '+balanceResult+" BURST");
                    done(result);
                }
                else{
                    poolProtocol.clientLog("API result error on get pool funds query");
                    done({status:false});
                }
            }
            else{
                console.log("http error on get pool funds query");
                console.log(error);
                done({status:false});
            }
        }
    );
}

function saveSession() {
    var data = {
        blockPaymentList : blockPaymentList,
        pendingPaymentList : pendingPaymentList,
        sentPaymentList : sentPaymentList
    };
    if(data.sentPaymentList.length > poolConfig.maxRecentPaymentHistory){
        var toRemove = data.sentPaymentList.length - poolConfig.maxRecentPaymentHistory;
        data.sentPaymentList.splice(0,toRemove);
    }

    var jsonData = JSON.stringify(data,null,2);
    fs.writeFileSync('pool-payments.json', jsonData);
}

function saveSessionAsync(done) {
    var data = {
        blockPaymentList : blockPaymentList,
        pendingPaymentList : pendingPaymentList,
        sentPaymentList : sentPaymentList
    };
    if(data.sentPaymentList.length > poolConfig.maxRecentPaymentHistory){
        var toRemove = data.sentPaymentList.length - poolConfig.maxRecentPaymentHistory;
        data.sentPaymentList.splice(0,toRemove);
    }

    var jsonData = JSON.stringify(data,null,2);
    fs.writeFile('pool-payments.json', jsonData, function(err){
        done(err);
    });
}

function getPendingPaymentAmount(){
    var total = 0;
    for(var accountId in pendingPaymentList){
        total += pendingPaymentList[accountId];
    }

    return total;
}

function getBalance(done){
    getPoolBalance(function(res){
        var pendingPaymentAmount = getPendingPaymentAmount();
        if(res.status === true){
            console.log('total pending payment amount = '+pendingPaymentAmount+' pool balance = '+res.balance);
            res.netBalance = res.balance - pendingPaymentAmount;
            res.pendingBalance = pendingPaymentAmount;
        }
        else{
            res.netBalance = 0;
            res.pendingBalance = pendingPaymentAmount;
        }
        done(res);
    });
}

function updateByNewBlock(height){
    try{
        blockPaymentList = [];
        var prevHeight = height - 1;
        do{
            var blockShare = poolShare.getBlockShare(prevHeight);
            if(blockShare.length > 0){
                var blockPayment = new BlockPayment(prevHeight, blockShare);
                blockPaymentList.push(blockPayment);
                //poolProtocol.clientLog("processing block payment #"+blockPayment.height+' pool-shares = '+blockPayment.poolShare.toFixed(3)+', total-miner-shares = '+blockPayment.totalShare.toFixed(3));
            }
            prevHeight--;
        }while(blockShare.length > 0);

        getBalance(function(res){
            if(res.status === true){
                var minPayout = poolConfig.minimumPayout;
                if( (poolSession.getCurrentBlockHeight() % 100) == 0){
                    minPayout = poolConfig.clearingMinPayout;
                }
                if(parseFloat(res.balance) > minPayout){
                    var poolFund = res.netBalance;
                    var prevFund = poolFund*poolConfig.nextBlockFundSaving;
                    var currentFund = poolFund - prevFund;
                    poolProtocol.clientLog("Pool balance : "+poolFund.toFixed(4)+' fund allocation for current block = '+currentFund.toFixed(4));
                    if(currentFund > minPayout){
                        assignCumulativeFund(height-1,currentFund);
                        distributeShareToPayment();
                    }
                    setTimeout(function(){
                        flushPaymentList(function(){});
                    },5000);
                }
                else{
                    console.log("pool does not have enough balance for payments");
                }
            }
            poolProtocol.getWebsocket().emit('shareList',JSON.stringify(poolShare.getCumulativeShares()));
            poolProtocol.getWebsocket().emit('balance',JSON.stringify(pendingPaymentList));
        });
    }
    catch(e){
        console.log(e);
        console.trace();
    }
}

module.exports = {
    updateByNewBlock : updateByNewBlock,
    getBalance : getBalance,
    saveSession : saveSession,
    loadSession : function(done) {
        if( fs.existsSync('pool-payments.json')) {
            fs.readFile('pool-payments.json', function(err, data) {
                try{
                    var loadedData = JSON.parse(data);
                    if(loadedData.hasOwnProperty('blockPaymentList')){
                        blockPaymentList = loadedData.blockPaymentList;
                    }
                    if(loadedData.hasOwnProperty('pendingPaymentList')){
                        pendingPaymentList = loadedData.pendingPaymentList;
                    }
                    if(loadedData.hasOwnProperty('sentPaymentList')){
                        sentPaymentList = loadedData.sentPaymentList;
                        if(sentPaymentList.length > poolConfig.maxRecentPaymentHistory){
                            var toRemove = sentPaymentList.length - poolConfig.maxRecentPaymentHistory;
                            sentPaymentList.splice(0,toRemove);
                        }
                    }
                }
                catch(e){
                    console.log(e);
                    console.trace();
                }
                done();
            });
        }
        else{
            done();
        }
    },
    getPaidList : function(){
        return sentPaymentList;
    }
};