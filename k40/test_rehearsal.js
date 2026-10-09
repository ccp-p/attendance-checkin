"auto";
// test_rehearsal.js - dry run: launch -> nav -> attendance page visible.
// Does NOT tap the punch button, does NOT request SMS.
var logger = require("./lib/logger.js");
logger.init();
var a11y = require("./a11y_guard.js");
var okA = a11y.ensure(25000);
logger.info("rehearsal a11y: " + okA);
if (!okA) exit(1);
var scenes = require("./scenes.js");
var r1 = scenes.launch();
logger.info("rehearsal launch: " + JSON.stringify(r1));
var r2 = scenes.nav();
logger.info("rehearsal nav: " + JSON.stringify(r2));
var btn = null;
var text1 = null;
for (var i = 0; i < 6 && !btn; i++) {
    btn = text("签到").findOne(3000) || text("签退").findOne(3000);
    if (!btn) sleep(2000);
}
if (btn) {
    logger.ok("rehearsal: punch button visible -> chain healthy for tomorrow");
} else {
    logger.error("rehearsal: punch button NOT visible");
}
