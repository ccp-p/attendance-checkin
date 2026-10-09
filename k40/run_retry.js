"auto";
// run_retry.js - watchdog entry: checkin with in-window retry.
// Fast phase: 3 attempts, 120s apart. Slow phase: every 10 min until the
// punch window closes (morning 08:25, evening 20:00). Covers transient
// server rejections ("no-need" popup) and pushplus SMS delays.
// Called by init-managed /data/adb/service.d/checkin_watchdog.sh.

var config = require("./config.js");
var logger = require("./lib/logger.js");
logger.init();
files.createWithDirs("/sdcard/checkin/autojs/state/");

function p2(n) { return (n < 10 ? "0" : "") + n; }
var d0 = new Date();
var isMorning = d0.getHours() < 12;
var slot = isMorning ? "morning" : "evening";
var today = d0.getFullYear() + "-" + p2(d0.getMonth() + 1) + "-" + p2(d0.getDate());
var MARKER = "/sdcard/checkin/autojs/state/done_" + slot + "_" + today + ".flag";

logger.info("====== 定时打卡 (run_retry.js) slot=" + slot + " ======");

if (files.exists(MARKER)) {
    logger.ok("今日 " + slot + " 已打过 (marker), 退出");
    exit(0);
}

var a11y = require("./a11y_guard.js");
if (!a11y.ensure(25000)) {
    logger.error("无障碍服务无法恢复, 放弃本次");
    exit(1);
}

var scenes = require("./scenes.js");
var names = ["launch", "nav", "attendance", "login", "getcode", "ppapi", "inputcode", "submit", "result"];

function tryOnce() {
    var r = scenes.all();
    var failed = null;
    for (var i = 0; i < names.length; i++) {
        if (!r[names[i]] || !r[names[i]].ok) { failed = names[i]; break; }
    }
    return { ok: failed === null, failed: failed, r: r };
}

function markDone() {
    try { files.write(MARKER, "ok " + new Date().toISOString()); } catch (e) {}
}

var MAX = 3, DELAY = 120 * 1000, SLOW = 10 * 60 * 1000;
var endH = isMorning ? 8 : 20, endM = isMorning ? 25 : 0;

function pastWindow() {
    var d = new Date();
    if (d.getHours() > endH) return true;
    if (d.getHours() === endH && d.getMinutes() >= endM) return true;
    return false;
}

var attempt = 0;
while (true) {
    attempt++;
    logger.info("attempt " + attempt);
    var out;
    try { out = tryOnce(); } catch (e) {
        logger.error("异常: " + e);
        out = { ok: false, failed: "exception" };
    }
    if (out.ok) {
        logger.ok("打卡成功 (attempt " + attempt + ")");
        markDone();
        break;
    }
    if (pastWindow()) {
        logger.error("打卡窗口已过 (" + endH + ":" + p2(endM) + "), 停止重试");
        break;
    }
    var wait = attempt < MAX ? DELAY : SLOW;
    logger.warn(out.failed + " 失败, " + (wait / 1000) + "s 后重试 (窗口至 " + endH + ":" + p2(endM) + ")");
    sleep(wait);
}
