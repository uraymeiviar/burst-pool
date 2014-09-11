var request         = require('request');
var config          = require('./burst-pool-config');
var async           = require('async');
var jsonFormat      = require('prettyjson');
var fs              = require('fs');

var sessionState = {
    currentWalletNdx : 0,
    genesisBlockId : 0,
    genesisBaseTarget : 0,
    genesisBlockTimestamp : 0,
    current : {
        blockHeight : 0,
        baseTarget : 0,
        startTime : 0,
        totalShare : 0,
        submitters : 0,
        bestDeadline : 0,
        totalPayments : 0,
        netDiff : 0
    },
    prevBlocks : []
};

function getWalletUrl(){
    if(sessionState.currentWalletNdx < config.wallets.length){
        return config.wallets[sessionState.currentWalletNdx].walletUrl+'/burst';
    }
    else{
        return config.wallets[0].walletUrl+'/burst';
    }
}

function getConstants(done){
    request.post( {
            url : getWalletUrl(),
            form: { requestType:'getConstants' }
        },
        function(error, res, body){
            var result = {
                status : false,
                msg : ''
            };
            if (!error && res.statusCode == 200) {
                try{
                    var bodyJson = JSON.parse(body);
                    if(bodyJson.hasOwnProperty('genesisBlockId')){
                        sessionState.genesisBlockId = bodyJson.genesisBlockId;
                        console.log("genesis block id = "+sessionState.genesisBlockId);
                    }
                    result.status = true;
                    result.msg = bodyJson;
                }
                catch(e){
                    result.status = false;
                }
            }
            done(result);
        }
    );
}

function getGenesisBlock(done) {
    if(sessionState.genesisBlockId == 0){
        getConstants(function(res){
            if(res.status === true){
                getGenesisBlock(done);
            }
        })
    }
    else{
        request.post(
            {
                url:getWalletUrl(),
                form: {
                    requestType : 'getBlock',
                    block : sessionState.genesisBlockId
                }
            },
            function(error, res, body){
                var result = {
                    status : true,
                    msg : null
                };
                if (!error && res.statusCode == 200) {
                    try{
                        result.msg = JSON.parse(body);
                        result.msg.blockId = sessionState.genesisBlockId;
                        if(result.msg.hasOwnProperty('baseTarget')){
                            sessionState.genesisBaseTarget = result.msg.baseTarget;
                            console.log("genesis base target = "+sessionState.genesisBaseTarget);
                        }
                    }
                    catch (e){

                    }
                }
                else {
                    result.status  = false;
                    result.msg = 'wallet error';
                }
                done(result);
            }
        );
    }
}

function getConstant(done){
    request.post( {
            url:getWalletUrl(),
            form: { requestType:'getConstants' }
        },
        function(error, res, body) {
            if (!error && res.statusCode == 200) {
                sessionState.walletConstant = JSON.parse(body);
            }
            done();
        }
    );
}

function getBlockchainTime(done){
    request.post( {
            url:getWalletUrl(),
            form: { requestType:'getTime' }
        },
        function(error2, res2, body2){
            if (!error2 && res2.statusCode == 200) {
                var currentTime = new Date().getTime();
                var blockTimestamp = JSON.parse(body2);
                sessionState.genesisBlockTimestamp = currentTime - parseInt(blockTimestamp.time)*1000;

                console.log('current timestamp '+currentTime);
                console.log("genesis-block blocktime "+blockTimestamp.time);
                console.log("genesis-block timestamp "+sessionState.genesisBlockTimestamp);
            }
            done();
        }
    );
}

var miningInfoCache = {};
function getMiningInfo(done){
    request.post( {
            url:getWalletUrl(),
            form: { requestType:'getMiningInfo' }
        },
        function(error3, res3, body3){
            var result = {
                status : false,
                msg : ''
            };
            if (!error3 && res3.statusCode == 200) {
                var miningInfo = JSON.parse(body3);
                result.status = true;
                result.msg = miningInfo;
                miningInfoCache = miningInfo;
            }
            done(result);
        }
    );
}

function getGenesisBaseTarget(){
    return sessionState.genesisBaseTarget;
}

function getCurrentBaseTarget(){
    return sessionState.current.baseTarget;
}

function isAccountIdAssignedToPool(accountId){
    return true;
}

function switchNextWallet(){
    if(config.wallets.length > 1){
        if(config.walletIndex+1 < config.wallets.length){
            sessionState.walletIndex = sessionState.walletIndex + 1;
            console.log('switch wallet to '+config.wallets[config.walletIndex].walletUrl+' ['+config.walletIndex+']');
        }
        else{
            sessionState.walletIndex = 0;
            console.log('switch wallet to '+config.wallets[config.walletIndex].walletUrl+' ['+config.walletIndex+']');
        }
    }
}

function getBlockInfo(blockId, done){
    request.post( {
            url:config.wallets[sessionState.walletIndex].walletUrl+'/burst',
            form: {
                requestType:'getBlock',
                block:blockId
            }
        },
        function(error3, res3, body3){
            var result = {
                status : false,
                data : {}
            };
            if (!error3 && res3.statusCode == 200) {
                result.status = true;
                result.data = JSON.parse(body3);
                result.data.blockId = blockId;
                result.data.unixTimestamp = sessionState.genesisBlockTimestamp + parseInt(result.data.timestamp)*1000;
            }
            done(result);
        }
    );
}

function getLastBlockId(done){
    request.post( {
            url:config.wallets[sessionState.walletIndex].walletUrl+'/burst',
            form: {
                requestType:'getBlockchainStatus'
            }
        },
        function(error3, res3, body3){
            var result = {
                status : false,
                data : {}
            };
            if (!error3 && res3.statusCode == 200) {
                result.status = true;
                result.data = JSON.parse(body3);
            }
            done(result);
        }
    );
}

function updateCurrentBlockState(done){
    getLastBlockId(function(result){
        if(result.status === true){
            getBlockInfo(result.data.lastBlock, function(result2){
                if(result2.status === true){
                    sessionState.current.blockInfo = result2.data;
                    sessionState.current.netDiff = sessionState.genesisBaseTarget / sessionState.current.blockInfo.baseTarget;
                    sessionState.current.startTime = sessionState.current.blockInfo.unixTimestamp;
                }
                done(result2.status);
            });
        }
        else{
            done(false);
        }
    });
}

module.exports = {
    getWalletUrl : getWalletUrl,
    getGenesisBaseTarget : getGenesisBaseTarget,
    getCurrentBaseTarget : getCurrentBaseTarget,
    getCurrentBlockHeight : function(){
        return sessionState.current.blockHeight;
    },
    getPoolDiff : function() {
        var B0 = parseFloat(getGenesisBaseTarget());
        var B  = parseFloat(sessionState.current.baseTarget);
        var Pd = config.poolDiff;
        var netDiff = B0/B;
        return netDiff/Pd;
    },
    getNetDiff : function() {
        var B0 = parseFloat(getGenesisBaseTarget());
        var B  = parseFloat(sessionState.current.baseTarget);
        return B0/B;
    },
    getState : function() {
        return sessionState;
    },
    getBlockInfo : getBlockInfo,
    getLastBlockId : getLastBlockId,
    isAccountIdAssignedToPool : isAccountIdAssignedToPool,
    switchNextWallet : switchNextWallet,
    getMiningInfo : getMiningInfo,
    updateByNewBlock : function(height, baseTarget, done){
        sessionState.prevBlocks.unshift(JSON.parse(JSON.stringify(sessionState.current)));
        if(sessionState.prevBlocks.length > 30){
            var toRemove = sessionState.prevBlocks.length - 30;
            sessionState.prevBlocks.splice(sessionState.prevBlocks.length-toRemove,toRemove);
        }
        sessionState.current.blockHeight = height;
        sessionState.current.baseTarget = baseTarget;
        sessionState.current.startTime = new Date().getTime();
        sessionState.current.blockInfo = {};
        sessionState.current.bestDeadline = -1;

        updateCurrentBlockState(done);
    },
    getMiningInfoCache : function(){
        return miningInfoCache;
    },
    getCurrentRoundStartTime : function(){
        return sessionState.current.startTime;
    },
    setWalletNdx : function(ndx){
        sessionState.walletIndex = ndx;
    },
    getWalletNdx : function(){
        sessionState.walletIndex++;
        if(sessionState.walletIndex >= config.wallets.length){
            sessionState.walletIndex = 0;
        }
        return sessionState.walletIndex;
    },
    init : function(done){
        this.loadSession(function(){
            async.parallel( [
                    function(callback){
                        getGenesisBlock(function(res){
                            callback();
                        });
                    },
                    function(callback){
                        getConstant(function(){
                            callback();
                        })
                    },
                    function(callback){
                        getBlockchainTime(function(){
                            callback();
                        })
                    },
                    function(callback){
                        getMiningInfo(function(result){
                            var currentTime = new Date().getTime();
                            sessionState.current.blockHeight = result.msg.height;
                            sessionState.current.roundStartTime = currentTime;
                            sessionState.current.baseTarget = result.msg.baseTarget;
                            callback();
                        })
                    },
                    function(callback){
                        updateCurrentBlockState(function(status){
                            callback();
                        });
                    }
                ],
                function(err, results){
                    done();
                }
            );
        });
    },
    saveSession : function(){
        var jsonData = JSON.stringify(sessionState,null,2);
        fs.writeFileSync('pool-session.json', jsonData);
    },
    loadSession : function(done) {
        if( fs.existsSync('pool-session.json')) {
            fs.readFile('pool-session.json', function(err, data) {
                try{
                    var loadedData = JSON.parse(data);
                    sessionState = loadedData;
                    if(sessionState.prevBlocks.length > 30){
                        var toRemove = sessionState.prevBlocks.length - 30;
                        sessionState.prevBlocks.splice(sessionState.prevBlocks.length-toRemove,toRemove);
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
    }
};