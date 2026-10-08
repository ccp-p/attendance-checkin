"auto";
// run_retry.js - watchdog entry: full checkin with retry (3 attempts, 120s)
// Called by /data/adb/service.d/checkin_watchdog.sh at 07:20 / 17:30.
var logger = require("./lib/logger.js");
logger.init();
files.createWithDirs("/sdcard/checkin/autojs/state/");

logger.info("====== 定时打卡 (run_retry.js) ======");

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

var MAX = 3, DELAY = 120 * 1000;
for (var attempt = 1; attempt <= MAX; attempt++) {
    logger.info("attempt " + attempt + "/" + MAX);
    var out;
    try { out = tryOnce(); } catch (e) { logger.error("异常: " + e); out = { ok: false, failed: "exception" }; }
    if (out.ok) {
        logger.ok("打卡成功 (attempt " + attempt + ")");
        exit(0);
    }
    if (out.r && out.r.result && out.r.result.restDay) { exit(0); }
    if (attempt < MAX) {
        logger.warn(out.failed + " 失败, " + (DELAY / 1000) + "s 后重试...");
        sleep(DELAY);
    }
}
logger.error(MAX + " 次全部失败");
