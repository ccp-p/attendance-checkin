"auto";

var config = require("./config.js");
var logger = require("./lib/logger.js");
var flow = require("./lib/flow.js");
var schedule = require("./schedule.js");

logger.init();
logger.initFloaty();
logger.info("====== attendance checkin started ======");
try {
    logger.info("device: " + device.brand + " " + device.model + " Android " + device.release);
} catch (e) {}

auto.waitFor();
logger.ok("accessibility service enabled");

try { device.keepScreenOn(30 * 60 * 1000); } catch (e) {}

if (config.schedule.enabled) {
    logger.info("schedule mode: " + config.schedule.times.join(", "));
    toast("scheduled checkin started");
    schedule.loop();
} else {
    logger.info("immediate execution mode");
    toast("starting checkin...");
    var ok = flow.run();
    if (ok) {
        toast("checkin success!");
        logger.ok("checkin success");
    } else {
        toast("checkin failed, check log");
        logger.error("checkin failed");
    }
    sleep(10000);
    logger.closeFloaty();
}
