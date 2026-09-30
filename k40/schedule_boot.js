"auto";
var logger = require("./lib/logger.js");
logger.init();
logger.info("开机自启动 schedule.js");
var a11y = require("./a11y_guard.js");
a11y.ensure(30000);
var sched = require("./schedule.js");
sched.loop();
