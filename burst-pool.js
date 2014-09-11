#!/usr/bin/env node
var fs              = require('fs');
var url             = require('url');
var moment          = require('moment');
var config          = require('./burst-pool-config');
var poolSession     = require('./burst-pool-session');
var poolShare       = require('./burst-pool-share');
var poolPayment     = require('./burst-pool-payment');
var poolProtocol    = require('./burst-pool-protocol');
var async       = require('async');

function onNewBlock(miningInfo){
    poolProtocol.clientLog("new block :");
    poolProtocol.clientLogJson(miningInfo);

    try{
        poolSession.updateByNewBlock(miningInfo.height,miningInfo.baseTarget, function(){
            poolShare.deleteRoundShareByDistance(config.maxRoundCount);
            poolShare.deleteAccountShareBelowThresshold(1.0,config.maxRoundCount);
            poolShare.saveSession();
            poolShare.updateByNewBlock(miningInfo.height, miningInfo.baseTarget);
            poolPayment.updateByNewBlock(miningInfo.height);
            poolPayment.saveSession();
            poolSession.saveSession();
            logMiningRound();

            console.log('new block #'+miningInfo.height+' BT:'+miningInfo.baseTarget+' ND:'+poolSession.getNetDiff());
            poolProtocol.getWebsocket().emit('shareList',JSON.stringify(poolShare.getCumulativeShares()));
            poolProtocol.getWebsocket().emit('blockHistory',JSON.stringify(poolSession.getState().prevBlocks));
        });
    }
    catch(e){
        console.log(e);
        console.trace();
    }
}

function logMiningRound(socket){
    var blockHeight = poolSession.getCurrentBlockHeight();
    var roundStart = poolSession.getCurrentRoundStartTime();
    var currentTime = new Date().getTime();
    var elapsed = currentTime - roundStart;
    var duration = moment.duration(elapsed).humanize(true);
    var roundShare = poolShare.getCurrentRoundShares();
    var submitters = roundShare.submitters;
    var netDiff = poolSession.getNetDiff();
    var sessionState = poolSession.getState();
    var miningInfo = {
        height      : blockHeight,
        currentTime : currentTime,
        totalShare  : roundShare.totalShare,
        submitters  : roundShare.submitters,
        roundStart  : roundStart,
        netDiff     : netDiff,
        bestDeadline: sessionState.current.bestDeadline
    };
    sessionState.current.submitters = roundShare.submitters;
    sessionState.current.totalShare = roundShare.totalShare;

    if(typeof socket === 'undefined'){
        poolProtocol.getWebsocket().emit('miningInfo',JSON.stringify(miningInfo));
        poolProtocol.clientLog("round #" + blockHeight + " diff "+netDiff.toFixed(1)+", elapsed " + duration + ", " + submitters + " Miners, total shares " + roundShare.totalShare.toFixed(2)+', best deadline '+roundShare.bestDeadline+' from '+roundShare.bestDeadlineAccount);
    }
    else{
        socket.emit('miningInfo',JSON.stringify(miningInfo));
        poolProtocol.clientUnicastLog(socket,"round #" + blockHeight + " diff "+netDiff.toFixed(1)+", elapsed " + duration + ", " + submitters + " Miners, total shares " + roundShare.totalShare.toFixed(2)+', best deadline '+roundShare.bestDeadline+' from '+roundShare.bestDeadlineAccount);
    }
}

function onNonceSubmitReq(req){

    var minerReq = null;
    try {
        minerReq = url.parse(req.url ,true);
    }
    catch (e){
        minerReq = null;
    }

    if( minerReq != null &&
        minerReq.hasOwnProperty('query') &&
        minerReq.query.hasOwnProperty('requestType')){
        if(minerReq.query.requestType.toLowerCase() == 'submitnonce'){
            var remoteAddr = req.connection.remoteAddress+':'+req.connection.remotePort;
            var minerData = {
                nonce : 0,
                from : remoteAddr
            };
            req.url = '/burst?requestType=submitNonce';

            if(minerReq.query.hasOwnProperty('nonce')){
                req.url+= '&nonce='+minerReq.query.nonce;
                minerData.nonce = parseInt(minerReq.query.nonce);
            }
            if(minerReq.query.hasOwnProperty('accountId')){ //<------ POOL MINING
                req.url+= '&accountId='+minerReq.query.accountId;
                minerData.accountId = minerReq.query.accountId;

                minerReq.query.secretPhrase = config.poolPvtKey;
                req.url+= '&secretPhrase='+config.poolPvtKey;
            }
            else {
                if(minerReq.query.hasOwnProperty('secretPhrase')){ //<----- SOLO MINING
                    var urlPhrase = minerReq.query.secretPhrase.replace(/%2B|%2b/g,'+');
                    req.url+= '&secretPhrase='+urlPhrase;
                }
            }

            req.isSubmitNonce = true;
            req.headers['content-length'] = "0";
            req.minerData = minerData;
        }
        else if(minerReq.query.requestType.toLowerCase() == 'getmininginfo'){
            req.isMiningInfo = true;
        }
    }

}

function onNonceSubmitedRes(req,res){
    if(req.hasOwnProperty('minerData')) {
        if (res.hasOwnProperty('deadline') &&
            req.minerData.hasOwnProperty('accountId')) {

            var deadline = parseInt(res.deadline);
            var accountId = req.minerData.accountId;
            process.nextTick(function(){
                req.minerData.deadline = deadline;
                req.minerData.submission = res.result;

                poolShare.updateByNewDeadline(accountId,deadline);

                var accountShare = poolShare.getAccountShare(accountId);
                if(accountShare != null){
                    poolProtocol.getWebsocket().emit('roundShares',JSON.stringify(accountShare));
                }

                var sessionState = poolSession.getState();

                var currentTime = new Date().getTime();
                var miningInfo = {
                    height      : sessionState.current.blockHeight,
                    currentTime : currentTime,
                    totalShare  : sessionState.current.totalShare,
                    submitters  : sessionState.current.submitters,
                    roundStart  : sessionState.current.startTime,
                    netDiff     : poolSession.getNetDiff(),
                    bestDeadline: sessionState.current.bestDeadline
                };

                if(sessionState.current.bestDeadline > deadline){
                    sessionState.current.bestDeadline = deadline;
                    console.log('new best deadline '+sessionState.current.bestDeadline);
                    poolProtocol.getWebsocket().emit('miningInfo',JSON.stringify(miningInfo));

                    poolProtocol.clientLog("new best deadline : #"+poolSession.getCurrentBlockHeight());
                    poolProtocol.clientLogJson(req.minerData);
                }
                if(sessionState.current.bestDeadline == -1){
                    sessionState.current.bestDeadline = deadline;
                    console.log('new best deadline '+sessionState.current.bestDeadline);
                    poolProtocol.getWebsocket().emit('miningInfo',JSON.stringify(miningInfo));

                    poolProtocol.clientLog("new best deadline : #"+poolSession.getCurrentBlockHeight());
                    poolProtocol.clientLogJson(req.minerData);
                }
            });
        }
    }
}


function onMiningInfoUpdate(res){

    var miningInfo = res;

    if(poolSession.getCurrentBlockHeight() < miningInfo.height){
        onNewBlock(miningInfo);
    }
}

function onNewClientConnected(socket){
    var clientIp   = socket.request.connection.remoteAddress;
    var clientPort = socket.request.connection.remotePort;

    socket.on('chat', function(msg){
        onWebsocketClientChat(clientIp,msg);
    });

    socket.on('disconnect', function() {
        //console.log('viewer disconnected from '+clientIp+":"+clientPort);
    });

    //socket.emit('log','<div class=".json-text>">Welcome to BurstPool, may the hash be with you!</div>');
    //poolProtocol.clientLog('viewer connected from '+clientIp+":"+clientPort);
    //console.log('viewer connected from '+clientIp+":"+clientPort);
    var cumulativeShare = poolShare.getCumulativeShares();
    socket.emit('shareList',JSON.stringify(cumulativeShare));
    socket.emit('sentList',JSON.stringify(poolPayment.getPaidList()));
    socket.emit('blockHistory',JSON.stringify(poolSession.getState().prevBlocks));
    logMiningRound(socket);
}

function onWebsocketClientChat(clientIp, msg){
    var textMsg = msg;
    if(textMsg.length > 256){
        textMsg = textMsg.substring(0, 255);
    }
    poolProtocol.clientLog(clientIp+' : '+'<span class="chatMsg">'+textMsg+'</span>');
}

function saveSession(){
    poolShare.saveSession();
    poolPayment.saveSession();
    poolSession.saveSession();
    logMiningRound();
}

function initPool(walletNdx){
    poolSession.setWalletNdx(walletNdx);
    poolSession.init(function(){
        async.parallel(
            [
                function(callback){
                    poolPayment.loadSession(function(){
                        callback();
                    })
                },
                function(callback){
                    poolShare.loadSession(function(){
                        callback();
                    });
                }
            ],
            function(err, results){
                poolProtocol.start(onNonceSubmitReq,onNonceSubmitedRes,onNewClientConnected);
                setInterval(saveSession,60000);
                setInterval(function(){
                    poolSession.getMiningInfo(function(result){
                        if(result.status === true){
                            onMiningInfoUpdate(result.msg);
                        }
                    });
                },1000);
            }
        );
    });
}

initPool(config.walletIndex);

process.stdin.resume();

function exitHandler(options, err) {
    poolShare.saveSession();
    if (options.cleanup) console.log('clean');
    if (err) console.log(err.stack);
    if (options.exit) process.exit();
}

process.on('exit', exitHandler.bind(null,{cleanup:true}));
process.on('SIGINT', exitHandler.bind(null, {exit:true}));
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));