$.ajaxSetup({
    cache: true
});

var templateCache = {};
function getTemplate(path, callback){
    if(templateCache.hasOwnProperty(path)){
        callback(templateCache[path]);
    }
    else {
        $.get(path, function(template){
            templateCache[path] = template;
            callback(template);
        });
    }
}

function renderTemplate(templatePath, data, done){
    getTemplate(templatePath, function(template) {
        var rowHtml = Mustache.render(template, data);
        done(rowHtml);
    });
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function sortRowList(containerId,childClass,childValueIdPrefix){
    var rowList = $('#'+containerId);
    var listitems = rowList.children('.'+childClass).get();
    listitems.sort(function(a, b) {
        var id_a = $(a).attr('id').split('-')[1];
        var id_b = $(b).attr('id').split('-')[1];
        var value_a = parseFloat($('#'+childValueIdPrefix+'-'+id_a).text());
        var value_b = parseFloat($('#'+childValueIdPrefix+'-'+id_b).text());
        return value_b - value_a;
    });
    $.each(listitems, function(idx, itm) { rowList.append(itm); });
}

function onShareList(jsonData){
    $('#shareList').empty();
    var nxt = new NxtAddress();
    for(var accountId in jsonData){
        var data = jsonData[accountId];
        data.share = data.share.toFixed(2);
        if(data.deadline == -1){
            data.deadline = "----";
            data.deadlineStr = "----";
        }
        else {
            data.accountRS = data.accountId;
            var duration = moment.duration(data.deadline*1000);
            data.deadlineStr = moment.utc(data.deadline*1000).format("HH : mm : ss");
        }

        if(data.deadline > 60*60 ){
            data.deadlineStr = duration.humanize();
        }
        if(jsonData.deadlineStr == 'Invalid date'){
            jsonData.deadlineStr = '---';
        }
        if(nxt.set(data.accountId)){
            jsonData[data.accountId].accountRS = nxt.toString();
        }
        var roundShareRow = $('#AllRoundItem-'+data.accountId);
        if(roundShareRow.length <= 0){
            renderTemplate('/templates/AllRoundShare.template', data, function(html){
                $('#shareList').prepend(html);
            });
        }
        else{
            $('#AllRoundItem-Deadline-'+data.accountId).html(data.deadline);
            $('#AllRoundItem-Share-'+data.accountId).html(data.share);
        }
    }
    sortRowList('shareList','AllRoundItem','AllRoundItem-Share');
}

function onSentList(jsonData){
    $('#lastSentTx').empty();
    var nxt = new NxtAddress();
    for(var i=0 ; i<jsonData.length ; i++){
        jsonData[i].accountRS = jsonData[i].accountId;
        if(nxt.set(jsonData[i].accountId)){
            jsonData[i].accountRS = nxt.toString();
        }
        var momentObj = moment(jsonData[i].sendTime);
        jsonData[i].amountStr = jsonData[i].amount.toFixed(2);
        jsonData[i].sendTimeStr = momentObj.format("DD/MM HH:mm:ss");
        renderTemplate('/templates/RecentPaymentItem.template', jsonData[i], function(html){
            $('#lastSentTx').prepend(html);
        });
    }
}

var userBalance = {};
function onRoundShare(jsonData){
    jsonData.share = jsonData.share.toFixed(2);
    jsonData.balance = '---';

    if(jsonData.deadline == -1){
        jsonData.deadline = "----";
        jsonData.deadlineStr = "----";
    }
    else {
        var duration = moment.duration(jsonData.deadline * 1000);
        jsonData.deadlineStr = moment.utc(jsonData.deadline*1000).format("HH : mm : ss");
        if (jsonData.deadline > 60 * 60) {
            jsonData.deadlineStr = duration.humanize();
        }
        if (jsonData.deadlineStr == 'Invalid date') {
            jsonData.deadlineStr = '---';
        }
    }
    if(userBalance.hasOwnProperty(jsonData.accountId)){
        jsonData.balance = userBalance[jsonData.accountId].toFixed(1);
    }
    var roundShareRow = $('#CurrentRoundItem-'+jsonData.accountId);
    if(roundShareRow.length <= 0){
        getTemplate('/templates/CurrentRoundShare.template', function(template) {
            jsonData.accountRS = jsonData.accountId;
            var nxt = new NxtAddress();
            if(nxt.set(jsonData.accountId)){
                jsonData.accountRS = nxt.toString();
            }
            var rowHtml = Mustache.render(template, jsonData);
            $('#roundShares').prepend(rowHtml);
        });
    }
    else{
        $('#CurrentRoundItem-Deadline-'+jsonData.accountId).html(jsonData.deadlineStr);
        $('#CurrentRoundItem-Share-'+jsonData.accountId).html(jsonData.share);
    }

    sortRowList('roundShares','CurrentRoundItem','CurrentRoundItem-Share');
}

var logRowCount = 0;
function onLog(data){
    logRowCount++;
    $('body').append('<div class="consoleRow">'+data+'<div/>');
    if(logRowCount > 50){
        $('body').children('.consoleRow:first').remove();
    }
    $('html, body').animate({ scrollTop: $(document).height() }, 1000);
}

function initBlocktimeChart() {
    var blocktimeChartGaugeElement = $('#BlocktimeGauge');
    var chartHeight = blocktimeChartGaugeElement.parent().innerWidth();
    blocktimeChartGaugeElement.width(chartHeight);
    blocktimeChartGaugeElement.height(chartHeight);
    blocktimeChartGaugeElement.easyPieChart({
        barColor: "#ff8911",
        scaleColor: false,
        trackColor: "#B16402",
        lineWidth: 9,
        lineCap: "square",
        size: chartHeight,
        animate: 500
    });
}

function resizeCanvas(element){
    var ctx = element.get(0).getContext("2d");
    element.width(element.parent().width()+'px');
    element.height(element.parent().height()+'px');
    ctx.canvas.width = element.parent().width();
    ctx.canvas.height = element.parent().height();
}

var blockHistory = [];
var NetDiffChart;
var BlockTimeChart;
var PaymentsChart;
var BestDeadlineChart;
var TotalSharesChart;
var TotalMinersChart;

function initMiningChart(){
    var lineChartOptions = {
        showScale: false,
        scaleBeginAtZero : false,
        scaleShowGridLines : false,
        scaleGridLineColor : "rgba(0,0,0,.05)",
        scaleGridLineWidth : 1,
        barShowStroke : false,
        barStrokeWidth : 0,
        barValueSpacing : 3,
        barDatasetSpacing : 1,
        pointHitDetectionRadius : 3,
        datasetFill : false,
        pointDot : true,
        pointDotRadius : 1.5,
        responsive: true,
        bezierCurve : false,
        maintainAspectRatio: false,
        tooltipFillColor: "rgba(64,64,64,0.6)",
        tooltipFontSize: 12
    };

    var NetDiffChartData = {
        labels: [],
        datasets: [
            {
                label: "Network Difficulty",
                fillColor: "#FFA300",
                strokeColor: "#FFA300",
                pointStrokeColor: "#FFA300",
                highlightFill: "#B16402",
                highlightStroke: "#B16402",
                pointColor: "#FFA300",
                pointHighlightFill: "#B16402",
                data: []
            }
        ]
    };

    var CanvasNetDiff = $("#CanvasNetDiff");
    var CanvasNetDiffCtx = CanvasNetDiff.get(0).getContext("2d");
    resizeCanvas(CanvasNetDiff);
    NetDiffChart = new Chart(CanvasNetDiffCtx).Line(NetDiffChartData, lineChartOptions);

    var BlockTimeChartData = {
        labels: [],
        datasets: [
            {
                label: "Block Mining Time",
                fillColor: "#FFA300",
                strokeColor: "#FFA300",
                pointStrokeColor: "#FFA300",
                highlightFill: "#B16402",
                highlightStroke: "#B16402",
                pointColor: "#FFA300",
                pointHighlightFill: "#B16402",
                data: []
            }
        ]
    };

    var CanvasBlockTime = $("#CanvasBlockTime");
    var CanvasBlockTimeCtx = CanvasBlockTime.get(0).getContext("2d");
    resizeCanvas(CanvasBlockTime);
    BlockTimeChart = new Chart(CanvasBlockTimeCtx).Line(BlockTimeChartData, lineChartOptions);

    var PaymentsChartData = {
        labels: [],
        datasets: [
            {
                label: "Payments",
                fillColor: "#FFA300",
                strokeColor: "#FFA300",
                pointStrokeColor: "#FFA300",
                highlightFill: "#B16402",
                highlightStroke: "#B16402",
                pointColor: "#FFA300",
                pointHighlightFill: "#B16402",
                data: []
            }
        ]
    };

    var CanvasPayments = $("#CanvasPayments");
    var CanvasPaymentsCtx = CanvasPayments.get(0).getContext("2d");
    resizeCanvas(CanvasPayments);
    PaymentsChart = new Chart(CanvasPaymentsCtx).Line(PaymentsChartData, lineChartOptions);

    var BestDeadlineChartData = {
        labels: [],
        datasets: [
            {
                label: "Best Deadline",
                fillColor: "#FFA300",
                strokeColor: "#FFA300",
                pointStrokeColor: "#FFA300",
                highlightFill: "#B16402",
                highlightStroke: "#B16402",
                pointColor: "#FFA300",
                pointHighlightFill: "#B16402",
                data: []
            }
        ]
    };

    var CanvasBestDeadline = $("#CanvasBestDeadline");
    var CanvasBestDeadlineCtx = CanvasBestDeadline.get(0).getContext("2d");
    resizeCanvas(CanvasBestDeadline);
    BestDeadlineChart = new Chart(CanvasBestDeadlineCtx).Line(BestDeadlineChartData, lineChartOptions);

    var TotalSharesChartData = {
        labels: [],
        datasets: [
            {
                label: "Total Shares",
                fillColor: "#FFA300",
                strokeColor: "#FFA300",
                pointStrokeColor: "#FFA300",
                highlightFill: "#B16402",
                highlightStroke: "#B16402",
                pointColor: "#FFA300",
                pointHighlightFill: "#B16402",
                data: []
            }
        ]
    };

    var CanvasTotalShares = $("#CanvasTotalShares");
    var CanvasTotalSharesCtx = CanvasTotalShares.get(0).getContext("2d");
    resizeCanvas(CanvasTotalShares);
    TotalSharesChart = new Chart(CanvasTotalSharesCtx).Line(TotalSharesChartData, lineChartOptions);

    var TotalMinersChartData = {
        labels: [],
        datasets: [
            {
                label: "Total Miners",
                fillColor: "#FFA300",
                strokeColor: "#FFA300",
                pointStrokeColor: "#FFA300",
                highlightFill: "#B16402",
                highlightStroke: "#B16402",
                pointColor: "#FFA300",
                pointHighlightFill: "#B16402",
                data: []
            }
        ]
    };

    var CanvasTotalMiners = $("#CanvasTotalMiners");
    var CanvasTotalMinersCtx = CanvasTotalMiners.get(0).getContext("2d");
    resizeCanvas(CanvasTotalMiners);
    TotalMinersChart = new Chart(CanvasTotalMinersCtx).Line(TotalMinersChartData, lineChartOptions);

    $('#chartContainer-BlockTime').hide();
    $('#chartContainer-Payments').hide();
    $('#chartContainer-TotalShares').hide();
    $('#chartContainer-TotalMiners').hide();
}

function updateMiningChart(){
    NetDiffChart.resize();
    BlockTimeChart.resize();
    PaymentsChart.resize();
    BestDeadlineChart.resize();
    TotalSharesChart.resize();
    TotalMinersChart.resize();

    for(var i=0; i<blockHistory.length-1 ; i++){
        var height = blockHistory[i].blockHeight;
        var netDiff = blockHistory[i].netDiff;
        var payments = blockHistory[i].totalPayments;
        var totalShare = blockHistory[i].totalShare;
        var totalMiners = blockHistory[i].submitters;
        var bestDeadline = blockHistory[i].bestDeadline;

        if(bestDeadline == -1){
            bestDeadline = 0;
        }
        var blockTime = 0;
        if(i > 0){
            blockTime = (blockHistory[i-1].startTime - blockHistory[i].startTime)/1000;
        }

        if(i < NetDiffChart.datasets[0].points.length){
            NetDiffChart.datasets[0].points[i].value = netDiff.toFixed(1);
            NetDiffChart.datasets[0].points[i].label = 'Block#'+height;
        }
        else{
            NetDiffChart.addData([netDiff], 'Block#'+height);
        }


        if(i < BlockTimeChart.datasets[0].points.length){
            BlockTimeChart.datasets[0].points[i].value = blockTime;
            BlockTimeChart.datasets[0].points[i].label = 'Block#'+height;
        }
        else{
            BlockTimeChart.addData([blockTime], 'Block#'+height);
        }


        if(i < PaymentsChart.datasets[0].points.length){
            PaymentsChart.datasets[0].points[i].value = payments.toFixed(2);
            PaymentsChart.datasets[0].points[i].label = 'Block#'+height;
        }
        else{
            PaymentsChart.addData([payments], 'Block#'+height);
        }


        if(i < BestDeadlineChart.datasets[0].points.length){
            BestDeadlineChart.datasets[0].points[i].value = bestDeadline;
            BestDeadlineChart.datasets[0].points[i].label = 'Block#'+height;
        }
        else{
            BestDeadlineChart.addData([bestDeadline], 'Block#'+height);
        }


        if(i < TotalSharesChart.datasets[0].points.length){
            TotalSharesChart.datasets[0].points[i].value = totalShare.toFixed(2);
            TotalSharesChart.datasets[0].points[i].label = 'Block#'+height;
        }
        else{
            TotalSharesChart.addData([totalShare], 'Block#'+height);
        }


        if(i < TotalMinersChart.datasets[0].points.length){
            TotalMinersChart.datasets[0].points[i].value = totalMiners;
            TotalMinersChart.datasets[0].points[i].label = 'Block#'+height;
        }
        else{
            TotalMinersChart.addData([totalMiners], 'Block#'+height);
        }
    }

    for(var n=0 ; n<NetDiffChart.datasets[0].points.length/2 ; n++){
        var val = NetDiffChart.datasets[0].points[n].value;
        var label = NetDiffChart.datasets[0].points[n].label;
        var len = NetDiffChart.datasets[0].points.length;

        NetDiffChart.datasets[0].points[n].value = NetDiffChart.datasets[0].points[len - (n+1)].value;
        NetDiffChart.datasets[0].points[n].label = NetDiffChart.datasets[0].points[len - (n+1)].label;

        NetDiffChart.datasets[0].points[len - (n+1)].value = val;
        NetDiffChart.datasets[0].points[len - (n+1)].label = label;
    }
    NetDiffChart.update();


    for(var n=0 ; n<TotalMinersChart.datasets[0].points.length/2 ; n++){
        var val = TotalMinersChart.datasets[0].points[n].value;
        var label = TotalMinersChart.datasets[0].points[n].label;
        var len = TotalMinersChart.datasets[0].points.length;

        TotalMinersChart.datasets[0].points[n].value = TotalMinersChart.datasets[0].points[len - (n+1)].value;
        TotalMinersChart.datasets[0].points[n].label = TotalMinersChart.datasets[0].points[len - (n+1)].label;

        TotalMinersChart.datasets[0].points[len - (n+1)].value = val;
        TotalMinersChart.datasets[0].points[len - (n+1)].label = label;
    }
    TotalMinersChart.update();

    for(var n=0 ; n<TotalSharesChart.datasets[0].points.length/2 ; n++){
        var val = TotalSharesChart.datasets[0].points[n].value;
        var label = TotalSharesChart.datasets[0].points[n].label;
        var len = TotalSharesChart.datasets[0].points.length;

        TotalSharesChart.datasets[0].points[n].value = TotalSharesChart.datasets[0].points[len - (n+1)].value;
        TotalSharesChart.datasets[0].points[n].label = TotalSharesChart.datasets[0].points[len - (n+1)].label;

        TotalSharesChart.datasets[0].points[len - (n+1)].value = val;
        TotalSharesChart.datasets[0].points[len - (n+1)].label = label;
    }
    TotalSharesChart.update();

    for(var n=0 ; n<BestDeadlineChart.datasets[0].points.length/2 ; n++){
        var val = BestDeadlineChart.datasets[0].points[n].value;
        var label = BestDeadlineChart.datasets[0].points[n].label;
        var len = BestDeadlineChart.datasets[0].points.length;

        BestDeadlineChart.datasets[0].points[n].value = BestDeadlineChart.datasets[0].points[len - (n+1)].value;
        BestDeadlineChart.datasets[0].points[n].label = BestDeadlineChart.datasets[0].points[len - (n+1)].label;

        BestDeadlineChart.datasets[0].points[len - (n+1)].value = val;
        BestDeadlineChart.datasets[0].points[len - (n+1)].label = label;
    }
    BestDeadlineChart.update();

    for(var n=0 ; n<PaymentsChart.datasets[0].points.length/2 ; n++){
        var val = PaymentsChart.datasets[0].points[n].value;
        var label = PaymentsChart.datasets[0].points[n].label;
        var len = PaymentsChart.datasets[0].points.length;

        PaymentsChart.datasets[0].points[n].value = PaymentsChart.datasets[0].points[len - (n+1)].value;
        PaymentsChart.datasets[0].points[n].label = PaymentsChart.datasets[0].points[len - (n+1)].label;

        PaymentsChart.datasets[0].points[len - (n+1)].value = val;
        PaymentsChart.datasets[0].points[len - (n+1)].label = label;
    }
    PaymentsChart.update();

    for(var n=0 ; n<BlockTimeChart.datasets[0].points.length/2 ; n++){
        var val = BlockTimeChart.datasets[0].points[n].value;
        var label = BlockTimeChart.datasets[0].points[n].label;
        var len = BlockTimeChart.datasets[0].points.length;

        BlockTimeChart.datasets[0].points[n].value = BlockTimeChart.datasets[0].points[len - (n+1)].value;
        BlockTimeChart.datasets[0].points[n].label = BlockTimeChart.datasets[0].points[len - (n+1)].label;

        BlockTimeChart.datasets[0].points[len - (n+1)].value = val;
        BlockTimeChart.datasets[0].points[len - (n+1)].label = label;
    }
    BlockTimeChart.update();

    TotalMinersChart.update();
    NetDiffChart.update();
    TotalSharesChart.update();
    BestDeadlineChart.update();
    PaymentsChart.update();
    BlockTimeChart.update();
}

var miningInfo = {};
function onMiningInfo(jsonData) {
    miningInfo = jsonData;
    updateRoundTime();
}

function updateRoundTime(){
    if(miningInfo.hasOwnProperty('height')){
        var currentTime   = new Date().getTime();
        var roundStart    = miningInfo.roundStart;
        var bestDeadline  = miningInfo.bestDeadline*1000;
        var targetTime    = roundStart + bestDeadline;
        var elapsed       = currentTime - roundStart;
        var progress      = 100 * elapsed / bestDeadline;

        var momentDeadline = moment.utc(bestDeadline).format("HH:mm:ss.S");
        var momentElapsed  = moment.utc(elapsed).format("HH:mm:ss.S");

        $('#BlocktimeGauge').data('easyPieChart').update(progress);
        $('#BestDeadlineLabel').html(momentDeadline);
        $('#RoundElapseTimeLabel').html(momentElapsed);
        $('#CurrentBlockLabel').html(miningInfo.height);
        $('#NetDiffLabel').html(miningInfo.netDiff.toFixed(1));
        $('#MinersLabel').html(miningInfo.submitters);
        $('#TotalShareLabel').html(miningInfo.totalShare.toFixed(3));
    }
}

function initTemplateCache(done){
    getTemplate('/templates/CurrentRoundShare.template', function(template) {
        getTemplate('/templates/AllRoundShare.template', function(template){
            getTemplate('/templates/RecentPaymentItem.template', function(template){
                done();
            });
        });
    });
}

$(document).ready(function(){
    initTemplateCache(function(){
        var serverUrl = window.location.protocol+'//'+location.hostname+':4443';
        var socket = io.connect(serverUrl,{"force new connection":true});
        var root = $('body');

        root.on('click','.chartGroupSelectorBtn',function(event){
            var id = event.target.id;
            var group = id.split('-')[1];
            var statId = id.split('-')[2];

            $('.chartGroupBtn-'+group).removeClass('chartGroupSelectorBtnActive');
            $('#'+id).addClass('chartGroupSelectorBtnActive');

            $('.canvasArea-'+group).hide();
            $('#chartContainer-'+statId).show();
            updateMiningChart();
        });

        socket.on('log', onLog);

        socket.on('ping', function(data){
            socket.emit('pong', {beat: 1});
        });

        socket.on('sentList', function(data){
            var jsonData = JSON.parse(data);
            onSentList(jsonData);
        });

        socket.on('shareList',function(data){
            var jsonData = JSON.parse(data);
            onShareList(jsonData);
        });

        socket.on('miningInfo', function(data){
            var jsonData = JSON.parse(data);
            onMiningInfo(jsonData);
        });

        socket.on('roundShares', function(data){
            var jsonData = JSON.parse(data);
            onRoundShare(jsonData);
        });

        socket.on('blockHistory', function(data){
            var jsonData = JSON.parse(data);
            blockHistory = jsonData;
            updateMiningChart();
        });

        socket.on('balance', function(data){
            var jsonData = JSON.parse(data);
            userBalance = jsonData;
        });

        socket.on('submitNonce', function(data){
            var jsonData = JSON.parse(data);
            console.log(jsonData);
        });

        $('#chatInput').keypress(function(e) {
            if(e.which == 13) {
                var text = escapeHtml($('#chatInput').val());
                if(text.length > 256){
                    text = text.substring(0, 255);
                }

                socket.emit('chat',text);
                $('#chatInput').val('');
            }
        });

        initBlocktimeChart();
        initMiningChart();
        setInterval(updateRoundTime,100);
    });
});