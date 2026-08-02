var config = require("./config.js");
var logger = require("./lib/logger.js");
var flow = require("./lib/flow.js");

// 定时调度:常驻循环,到点自动执行打卡
var lastRunKey = "";

function hhmm() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes());
}

function dayKey(t) {
    var d = new Date();
    return d.toDateString() + " " + t;
}

function runOnce() {
    try { device.wakeUp(); } catch (e) {}
    try { device.keepScreenOn(10 * 60 * 1000); } catch (e) {}
    sleep(1000);
    flow.run();
}

function loop() {
    logger.info("定时调度已启动,打卡时间: " + config.schedule.times.join(", "));
    var interval = (config.schedule.checkIntervalSec || 30) * 1000;

    while (true) {
        var t = hhmm();
        var key = dayKey(t);
        if (config.schedule.times.indexOf(t) >= 0 && key !== lastRunKey) {
            lastRunKey = key;
            logger.info("到达打卡时间: " + t);
            try {
                runOnce();
            } catch (e) {
                logger.error("定时执行异常: " + e);
            }
        }
        sleep(interval);
    }
}

module.exports = { loop: loop, runOnce: runOnce };
