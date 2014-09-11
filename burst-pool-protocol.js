var poolSession     = require('./burst-pool-session');
var poolConfig      = require('./burst-pool-config');
var jsonMarkup      = require('json-markup');
var jsonFormat      = require('prettyjson');
var url             = require('url');
var request         = require('request');
var compression     = require('compression');
var express         = require('express');
var httpProxy       = require('http-proxy');
var path            = require('path');
var http            = require('http');
var bodyParser      = require('body-parser');
var io              = require('socket.io')();
var ioSocket = null;

function duplicate(obj){
    return JSON.parse(JSON.stringify(obj));
}

function initWalletProxy(){
    for(var i=0 ; i<poolConfig.wallets.length ; i++){
        poolConfig.wallets[i].proxy = httpProxy.createProxyServer({});
        poolConfig.wallets[i].proxy.on('error', function (err, req, res) {
            console.log(err);
            res.writeHead(500, { 'Content-Type': 'text/plain'});
            res.end('Internal Server Error, or Resource Temporary Unavailable');
        });
    }
}

function proxify(req, res){
    if(poolConfig.walletIndex < poolConfig.wallets.length){
        try{
            var proxy = poolConfig.wallets[poolSession.getWalletNdx()].proxy;
            proxy.web(req, res, { target: poolConfig.wallets[poolSession.getWalletNdx()].walletUrl });
        }
        catch(e){
            console.log('exception while proxify');
            console.log(e);
            console.trace();
        }
    }
}

function doRedirection(req, body){
    if(poolConfig.redirection.enabled === true){
        var redirectUrl = poolConfig.redirection.target+req.url;
        request({
            url :redirectUrl,
            method : 'POST',
            body:body
        },function(){});
    }
}

function transformRequest(req, res, nonceSubmitReqHandler){
    var reqBody = '';
    req.on('data', function (reqChunk) {
        if(req.isSubmitNonce === true){
            reqBody += reqChunk;
            if(reqBody.length > 1024){
                req.connection.destroy();
            }
        }
    });

    req.on('end', function () {
        if(req.isSubmitNonce === true){
            if(reqBody.length > 0){
                req.url = '/burst?'+reqBody;
                nonceSubmitReqHandler(req);
            }
            reqBody = '';
        }
        doRedirection(req,reqBody);
    });
    nonceSubmitReqHandler(req);
}

function transformResponse(req,res, nonceSubmitedHandler){
    var recvBuffer = '';
    var _write = res.write;
    res.write = function(data){
        if(typeof data != 'undefined'){
            recvBuffer += data.toString();
        }
    };

    var _end = res.end;
    res.end = function(){
        try {
            if(recvBuffer.length > 0){
                if(recvBuffer[0] != '{'){
                    //console.log(recvBuffer);
                }
                else{
                    var response = JSON.parse(recvBuffer);
                    if(req.isSubmitNonce === true) {
                        nonceSubmitedHandler(req,response);
                    }
                    //else if(req.isMiningInfo === true){
                    //    recvBuffer = miningInfoHandler(response);
                    //}
                }
            }
        }
        catch(e){
            console.log(e);
            console.trace();
        }
        _write.call(res,recvBuffer);
        _end.call(res);
    }
}

function respondToGetMiningInfo(req, res) {
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify(poolSession.getMiningInfoCache()));
}

function initHttpAPIServer(nonceSubmitReqHandler,
                           nonceSubmitedHandler ){

    var poolHttpServer = http.createServer(function(req, res) {
        transformRequest(req, res, nonceSubmitReqHandler);
        if(req.hasOwnProperty('isMiningInfo') && req.isMiningInfo){
            respondToGetMiningInfo(req, res);
        }
        else{
            transformResponse(req,res, nonceSubmitedHandler);
            proxify(req,res);
        }
    });

    poolHttpServer.listen(poolConfig.poolPort,"0.0.0.0");
    console.log("burst pool running on port "+poolConfig.poolPort);
}

function initWebsocketServer(newClientHandler){
    var ioOption = {
        origins: '*:*',
        'pingTimeout' : 60000,
        'allowUpgrades' : true,
        'transports': [
            'polling',
            'websocket'
        ]
    };

    ioSocket = io.listen(poolConfig.websocketPort,ioOption);
    console.log("websocket running on port "+poolConfig.websocketPort);
    ioSocket.on('connection', newClientHandler);

    function sendHeartbeat(){
        setTimeout(sendHeartbeat, 5000);
        ioSocket.emit('ping', { beat : 1 });
    }

    setTimeout(sendHeartbeat, 5000);
}

function initWebserver(){
    var app = express();

    app.use(compression({
        threshold: 64
    }));
    app.use(express.static(path.join(__dirname, 'client')));
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    app.get('/burst', function(req,res){
        //setTimeout(function(){
            request.get({
                url:'http://127.0.0.1:'+poolConfig.poolPort+req.url,
                method : 'GET'
            }).pipe(res);
        //}, Math.random()*500);
    });

    app.post('/burst', function(req,res){
        //setTimeout(function(){
            request({
                url :  'http://127.0.0.1:'+poolConfig.poolPort+req.url,
                method : 'POST',
                form : req.body
            }, function(err, response, body){
                if(typeof body != 'undefined' && body != null && body.length > 0){
                    res.write(body);
                }
                res.end();
            });
        //}, Math.random()*500);
    });

    app.use(function(req, res, next) {
        res.send('404 Not Found');
    });


    app.listen(poolConfig.httpPort, function() {
        console.log('http server running on port ' + poolConfig.httpPort);
    });
}

function consoleJson(json){
    try{
        console.log(jsonFormat.render(json));
    }
    catch(e){
        console.log('jsonFormat error');
        console.trace();
    }
}

function clientLogJson(json){
    try{
        var str = jsonMarkup(json);
        ioSocket.emit('log',str);
        if(poolConfig.logWebsocketToConsole === true){
            consoleJson(json);
        }
    }
    catch(e){
        console.log("jsonMarkup error");
        console.trace();
    }
}

function clientUnicastLogJson(socket,json){
    try{
        var str = jsonMarkup(json);
        socket.emit('log',str);
    }
    catch(e)
    {
        console.log("jsonMarkup error");
        console.trace();
    }
}

function clientLog(str){
    ioSocket.emit('log','<span class="json-text">'+str+'</span>');
    if(poolConfig.logWebsocketToConsole === true){
        console.log(str);
    }
}

function clientUnicastLog(socket,str){
    socket.emit('log','<span class="json-text">'+str+'</span>');
    if(poolConfig.logWebsocketToConsole === true){
        console.log(str);
    }
}


module.exports = {
    start : function(nonceSubmitReqHandler, nonceSubmitedHandler, newClientHandler){
        try{
            http.globalAgent.maxSockets = 100;
            initWebserver();
            initWalletProxy();
            initHttpAPIServer(nonceSubmitReqHandler, nonceSubmitedHandler);
            initWebsocketServer(newClientHandler);
        }
        catch(e){
            console.log(e);
            console.trace();
        }
    },
    getWebsocket : function(){
        return ioSocket;
    },
    clientLogJson : clientLogJson,
    clientUnicastLogJson : clientUnicastLogJson,
    clientLog : clientLog,
    clientUnicastLog : clientUnicastLog,
    consoleJson : consoleJson,
    httpPostForm : function(req, formData, done){
        try{
            var form = duplicate(formData);
            form.requestType = req;
            request.post(
                {
                    url : poolSession.getWalletUrl(),
                    form: form
                },
                done
            );
        }
        catch(e){
            console.log(e);
            console.trace();
        }
    }
};