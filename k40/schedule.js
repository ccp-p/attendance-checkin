var config = require("./config.js");
var logger = require("./lib/logger.js");
var a11y = require("./a11y_guard.js");

// 定时调度:常驻循环,到点自动执行打卡,失败自动重试
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

function tryRun() {
    // self-heal accessibility before every run
    if (!a11y.ensure(25000)) {
        logger.error("定时: 无障碍服务无法恢复, 跳过本次");
        return false;
    }
    var scenes = require("./scenes.js");
    var r = scenes.all();
    var names = ["launch", "nav", "attendance", "login", "getcode", "ppapi", "inputcode", "submit", "result"];
    var failed = null;
    for (var i = 0; i < names.length; i++) {
        if (!r[names[i]] || !r[names[i]].ok) { failed = names[i]; break; }
    }
    if (failed === null) {
        logger.ok("定时打卡成功!");
        return true;
    }
    if (r.attendance && r.attendance.restDay) {
        logger.ok("定时: 今天休息, 无需打卡");
        return true;
    }
    logger.error("定时打卡在 " + failed + " 环节失败");
    return false;
}

function runOnce() {
    try { device.wakeUp(); } catch (e) {}
    try { device.keepScreenOn(10 * 60 * 1000); } catch (e) {}
    sleep(1000);

    var maxRetry = config.schedule.retryCount || 3;
    var delayMs = (config.schedule.retryDelaySec || 120) * 1000;

    for (var attempt = 1; attempt <= maxRetry; attempt++) {
        logger.info("定时打卡 attempt " + attempt + "/" + maxRetry);
        try {
            if (tryRun()) return true;
        } catch (e) {
            logger.error("定时执行异常 (attempt " + attempt + "): " + e);
        }
        if (attempt < maxRetry) {
            logger.warn("等待 " + (delayMs / 1000) + "s 后重试...");
            sleep(delayMs);
        }
    }
    logger.error("定时打卡 " + maxRetry + " 次全部失败, 等待下一次定时");
    return false;
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
