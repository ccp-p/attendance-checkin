// scenes_main.js - entry point.
// Runs one scene by name (from script args) or the full chain with "all".
//
// Standalone test:
//   AutoJs6 -> run this file -> input scene name, e.g. "nav"
// Scheduled runs:
//   crond -> am broadcast ... or autojs6 tasker; passes "all"
"auto";

var logger = require("./lib/logger.js");
logger.init();

var scenes = require("./scenes.js");

// Scene name channel: intent extras do NOT reach execArgv in AutoJs6
// (verified: execArgv is always {}). The trigger script therefore writes
// the scene name to /sdcard/checkin/autojs/scene.args and deletes it
// after reading (one-shot semantics).
var name = "all";
var ARG_FILE = "/sdcard/checkin/autojs/scene.args";
try {
    if (files.exists(ARG_FILE)) {
        var v = files.read(ARG_FILE);
        files.remove(ARG_FILE);
        if (v) name = v.trim();
    }
} catch (e) { logger.warn("args read failed: " + e); }
logger.info("====== scene test: " + name + " ======");

// Accessibility health gate: if the a11y service is dead, every scene
// fails with "未找到文字". Re-enable and wait for rebind first; abort
// (exit code 3) so the cron wrapper knows to fall back to shell flow.
var a11y = require("./a11y_guard.js");
if (!a11y.ensure(25000)) {
    logger.error("accessibility unusable - aborting so wrapper falls back");
    toast("checkin: a11y dead, fallback");
    sleep(3000);
    exit(3);
}
logger.ok("accessibility healthy");

var r;
try {
    if (typeof scenes[name] !== "function") {
        logger.error("unknown scene: " + name + " (valid: launch nav attendance location login getcode ppapi inputcode submit result all)");
        exit();
    }
    r = scenes[name]();
} catch (e) {
    logger.error("scene exception: " + e);
    exit();
}

logger.info("RESULT " + name + ": " + JSON.stringify(r));
toast("scene " + name + ": " + (r && r.ok ? "OK" : "FAIL"));
// keep the floaty log visible briefly
sleep(5000);
logger.closeFloaty && logger.closeFloaty();
