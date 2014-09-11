var config = require('./burst-pool-config');
var poolSession = require('./burst-pool-session');
var poolProtocol = require('./burst-pool-protocol');
var fs              = require('fs');

function duplicate(obj){
    return JSON.parse(JSON.stringify(obj));
}

function fromDeadline(deadline, blockBaseTarget){
    //S:share, D:deadline, Pd:poolDiff, T:netDiff, B:netBasetarget, B0:netBaseTarget-Block0
    //S(D) = 100 / ( (D*B0)/(Pd*B) + 1)^5
    // 100
    // ----
    // ( D*Nd / Pd + 1 )^3  ---->  ( D * (B0/B) / Pd  )
    var B0 = parseFloat(poolSession.getGenesisBaseTarget());
    var B  = parseFloat(blockBaseTarget);
    var D  = parseFloat(deadline);
    var Pd = parseFloat(config.poolDiff);

    return 1000 / Math.pow((D*B0) / (Pd*B) + 1, config.poolDiffCurve);
}

function fromDeadlineCurrentBlock(deadline){
    return fromDeadline(deadline,poolSession.getCurrentBaseTarget());
}

RoundShare = function(accountId,height, baseTarget){
    this.accountId = accountId;
    this.baseTarget = baseTarget;
    this.height = height;
    this.share = 0;
    this.deadline = -1;
    this.lastUpdate = 0;
};

RoundShare.prototype.updateByNewDeadline = function(deadline){
    var assignedShare = 0;

    if(this.deadline < 0){
        this.deadline = deadline;
        var oldShare = this.share;
        this.share = fromDeadlineCurrentBlock(deadline);
        assignedShare = this.share - oldShare;
    }
    else if(deadline < this.deadline){
        this.deadline = deadline;
        var oldShare = this.share;
        this.share = fromDeadlineCurrentBlock(deadline);
        assignedShare = this.share - oldShare;
    }
    else if(deadline > this.deadline){
        this.substractShare(config.sharePenalty);
        assignedShare = 0;
    }
    this.lastUpdate = new Date().getTime();
    return assignedShare;
};

RoundShare.prototype.updateByNewBlock = function(height, baseTarget){
    this.baseTarget = baseTarget;
    this.height = height;
    this.share = 0;
    this.deadline = -1;
    this.lastUpdate = new Date().getTime();
};

RoundShare.prototype.addShare = function(share){
    if(typeof share != 'undefined' && !isNaN(share)){
        this.share += share;
    }
};

RoundShare.prototype.substractShare = function(share){
    if(typeof share != 'undefined' && !isNaN(share)){
        if(this.share < share){
            this.share = 0;
        }
        else {
            this.share -= share;
        }
    }
};

AccountShare = function(accountId,height, baseTarget){
    this.id = accountId;
    this.currentRoundShare = new RoundShare(accountId, height, baseTarget);
    this.prevRoundShare = [];
};

AccountShare.prototype.loadFromJSON = function(json){
    this.currentRoundShare = new RoundShare(json.currentRoundShare.accountId, json.currentRoundShare.height, json.currentRoundShare.baseTarget);
    this.prevRoundShare = [];
    for(var i in json.prevRoundShare){
        var roundShare = json.prevRoundShare[i];
        var newRoundShare = new RoundShare(roundShare.accountId, roundShare.height, roundShare.baseTarget);
        newRoundShare.share = roundShare.share;
        newRoundShare.deadline = roundShare.deadline;
        newRoundShare.lastUpdate = roundShare.lastUpdate;
        this.prevRoundShare.push(newRoundShare);
    };
};

AccountShare.prototype.updateByNewBlock = function( height, baseTarget){
    this.prevRoundShare.unshift(duplicate(this.currentRoundShare));
    this.currentRoundShare.updateByNewBlock(height, baseTarget);
};

AccountShare.prototype.updateByNewDeadline = function(deadline){
    return this.currentRoundShare.updateByNewDeadline(deadline);
};

AccountShare.prototype.getShareOnBlock = function(height){
    if(this.currentRoundShare.height == height){
        return this.currentRoundShare.share;
    }
    else{
        for(var i=0 ; i<this.prevRoundShare.length ; i++){
            if(this.prevRoundShare[i].height == height){
                return this.prevRoundShare[i].share;
            }
        }
    }
    return null;
};

AccountShare.prototype.deleteRoundShareByDistance = function(distance){
    if(this.prevRoundShare.length > distance){
        var blockExpired = this.currentRoundShare.height - distance;
        poolProtocol.clientLog('Account '+this.currentRoundShare.accountId+' share below Block#'+blockExpired+' is expired');
        this.prevRoundShare.splice(distance,this.prevRoundShare.length - distance);
    }
};

AccountShare.prototype.getShare = function(){
    return this.currentRoundShare.share;
};

AccountShare.prototype.addShare = function(share){
    this.currentRoundShare.addShare(share);
};

AccountShare.prototype.substractShare = function(share){
    this.currentRoundShare.substractShare(share);
};


PoolShare = function(){
    this.accountShare = [];
    this.accountShareIdIndex = {};
};

PoolShare.prototype.updateByNewDeadline = function(accountId, deadline){
    var share;
    var poolShare;
    var userShare = 0;
    if(this.accountShareIdIndex.hasOwnProperty(accountId)){
        share = this.accountShareIdIndex[accountId].updateByNewDeadline(deadline);
        userShare = this.accountShareIdIndex[accountId].getShare();
        poolShare = share*config.poolFee;
        this.addShareToAccount(config.poolFeePaymentAddr,poolShare);
    }
    else{
        if(poolSession.isAccountIdAssignedToPool(accountId)){
            var newAccountShare = new AccountShare(accountId,poolSession.getCurrentBlockHeight(),poolSession.getCurrentBaseTarget());
            share = newAccountShare.updateByNewDeadline(deadline);
            this.accountShare.push(accountId);
            this.accountShareIdIndex[accountId] = newAccountShare;
            userShare = this.accountShareIdIndex[accountId].getShare();
            poolShare = share*config.poolFee;
            this.addShareToAccount(config.poolFeePaymentAddr,poolShare);
        }
    }
    //console.log("share #"+poolSession.getCurrentBlockHeight()+' '+accountId+' ('+userShare.toFixed(4)+') D:'+deadline+'secs S:'+share.toFixed(4)+' PS:'+poolShare.toFixed(4));
};

PoolShare.prototype.updateByNewBlock = function(height, baseTarget){
    for(var accountId in this.accountShareIdIndex){
        this.accountShareIdIndex[accountId].updateByNewBlock(height,baseTarget);
    }
};

PoolShare.prototype.getBlockShare = function(height){
    var shareList = [];
    for(var accountId in this.accountShareIdIndex){
        var account = this.accountShareIdIndex[accountId];
        var accountShare = account.getShareOnBlock(height);
        var shareItem = {
            accountId : accountId,
            share : accountShare
        };
        if(shareItem.share > 0){
            shareList.push(shareItem);
        }
    }
    return shareList;
};

PoolShare.prototype.getShares = function(){
    var blockShareList = {};
    for(var accountId in this.accountShareIdIndex){
        var roundShareList = [];
        roundShareList.push(this.accountShareIdIndex[accountId].currentRoundShare);
        roundShareList = roundShareList.concat(this.accountShareIdIndex[accountId].prevRoundShare);
        blockShareList[accountId] = duplicate(roundShareList);
    }
    return blockShareList;
};

PoolShare.prototype.getCurrentRoundShares = function(){
    var blockShareList = {};
    var totalShare = 0;
    var bestDeadline = -1;
    var submitters = 0;
    var bestDeadlineAccount = 0;
    for(var accountId in this.accountShareIdIndex){
        var roundShareList = [];
        roundShareList.push(this.accountShareIdIndex[accountId].currentRoundShare);
        blockShareList[accountId] = duplicate(roundShareList);
        totalShare += this.accountShareIdIndex[accountId].currentRoundShare.share;

        if(this.accountShareIdIndex[accountId].currentRoundShare.deadline > 0){
            if(bestDeadline == -1){
                bestDeadline = this.accountShareIdIndex[accountId].currentRoundShare.deadline;
                bestDeadlineAccount = accountId;
            }
            else if(bestDeadline > this.accountShareIdIndex[accountId].currentRoundShare.deadline){
                bestDeadline = this.accountShareIdIndex[accountId].currentRoundShare.deadline;
                bestDeadlineAccount = accountId;
            }
        }
        submitters++;
    }
    blockShareList.totalShare = totalShare;
    blockShareList.bestDeadline = bestDeadline;
    blockShareList.submitters = submitters;
    blockShareList.bestDeadlineAccount = bestDeadlineAccount;
    return blockShareList;
};

PoolShare.prototype.getCumulativeShares = function(){
    var blockShareList = this.getShares();
    var cumulativeShare = {};
    for(var accountId in blockShareList){
        var shareList = blockShareList[accountId];
        shareList.forEach(function(share){
            if(cumulativeShare.hasOwnProperty(accountId)){
                cumulativeShare[accountId].share += share.share;
                cumulativeShare[accountId].roundCount++;
                if(share.deadline > 0){
                    if(cumulativeShare[accountId].deadline < 0){
                        cumulativeShare[accountId].deadline = share.deadline;
                    }
                    else if( share.deadline < cumulativeShare[accountId].deadline){
                        cumulativeShare[accountId].deadline = share.deadline;
                    }
                }
            }
            else{
                cumulativeShare[accountId] = share;
                cumulativeShare[accountId].roundCount = 1;
            }
        });
    }
    return cumulativeShare;
};

PoolShare.prototype.getAccountShare = function(accountId){
    if(this.accountShareIdIndex.hasOwnProperty(accountId)){
        var accountShare = this.accountShareIdIndex[accountId];
        return accountShare.currentRoundShare;
    }
    return null;
};

PoolShare.prototype.deleteAccount = function(accountId){
    if(this.accountShareIdIndex.hasOwnProperty(accountId)){
        delete this.accountShareIdIndex[accountId];
        var ndx = this.accountShare.indexOf(accountId);
        if(ndx >= 0 ){
            this.accountShare.splice(ndx,1);
        }
    }
};

PoolShare.prototype.deleteAccountShare = function(accountId){
    if(this.accountShareIdIndex.hasOwnProperty(accountId)){
        var accountShare = this.accountShareIdIndex[accountId];
        accountShare.prevRoundShare = [];
    }
};

PoolShare.prototype.deleteAccountShareBelowThresshold = function(shareAmount,numOfRound){
    var cumulativeShare = this.getCumulativeShares();
    for(var accountId in cumulativeShare){
        if( cumulativeShare[accountId].share < shareAmount &&
            cumulativeShare[accountId].roundCount > numOfRound){
            this.deleteAccount(accountId);
            console.log("deleted account "+accountId+" because of low share");
        }
    }
};

PoolShare.prototype.deleteRoundShareByDistance = function(distance){
    for(var accountId in this.accountShareIdIndex){
        var account = this.accountShareIdIndex[accountId];
        account.deleteRoundShareByDistance(distance);
    }
};

PoolShare.prototype.addShareToAccount = function(accountId, share){
    if(this.accountShareIdIndex.hasOwnProperty(accountId)){
        this.accountShareIdIndex[accountId].addShare(share);
    }
    else{
        if(poolSession.isAccountIdAssignedToPool(accountId)){
            var newAccountShare = new AccountShare(accountId,poolSession.getCurrentBlockHeight(),poolSession.getCurrentBaseTarget());
            newAccountShare.addShare(share);
            this.accountShare.push(accountId);
            this.accountShareIdIndex[accountId] = newAccountShare;
        }
    }
};

PoolShare.prototype.substractShareFromAccount = function(accountId, share){
    if(this.accountShareIdIndex.hasOwnProperty(accountId)){
        this.accountShareIdIndex[accountId].substractShare(share);
    }
};

var poolShare = new PoolShare();

module.exports = {
    addShareToAccount : function(accountId,share){
        poolShare.addShareToAccount(accountId, accountId);
    },
    updateByNewBlock : function(height, baseTarget){
        poolShare.updateByNewBlock(height, baseTarget);
    },
    updateByNewDeadline : function(accountId, deadline){
        poolShare.updateByNewDeadline(accountId, deadline);
    },
    getBlockShare : function(height){
        return poolShare.getBlockShare(height);
    },
    getShares : function(){
        return poolShare.getShares();
    },
    getCumulativeShares : function(){
        return poolShare.getCumulativeShares();
    },
    getAccountShare : function(accountId){
        return poolShare.getAccountShare(accountId);
    },
    saveSession : function(){
        var poolShareData = JSON.stringify(poolShare,null,2);
        fs.writeFileSync('pool-share.json', poolShareData);
    },
    getCurrentRoundShares : function(){
        return poolShare.getCurrentRoundShares();
    },
    deleteAccountShare : function(accountId){
        poolShare.deleteAccountShare(accountId);
    },
    deleteRoundShareByDistance : function(distance){
        poolShare.deleteRoundShareByDistance(distance);
    },
    deleteAccountShareBelowThresshold : function(shareAmount,numOfRound){
        poolShare.deleteAccountShareBelowThresshold(shareAmount,numOfRound);
    },
    deleteAccount : function(accountId){
        poolShare.deleteAccount(accountId);
    },
    loadSession : function(done){
        if( fs.existsSync('pool-share.json')) {
            fs.readFile('pool-share.json', function(err, data) {
                try{
                    var loadedData = JSON.parse(data);
                    if(loadedData.hasOwnProperty('accountShare')){
                        poolShare.accountShare = loadedData.accountShare;
                    }
                    if(loadedData.hasOwnProperty('accountShareIdIndex')){
                        for(var accountId in loadedData.accountShareIdIndex){
                            var accountShare = loadedData.accountShareIdIndex[accountId];
                            poolShare.accountShareIdIndex[accountId] = new AccountShare(0,0,0);
                            poolShare.accountShareIdIndex[accountId].accountId = accountId;
                            poolShare.accountShareIdIndex[accountId].loadFromJSON(accountShare);
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
    shareFromDeadline : fromDeadline
};