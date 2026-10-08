"auto";
// test_fit.js - measure _fitBase64 ladder sizes on the latest success shot
var logger = require("./lib/logger.js");
logger.init();
var scenes = require("./scenes.js");
var dir = "/sdcard/checkin/autojs/shots/";
var f = new java.io.File(dir);
var files_ = f.listFiles();
var latest = null, latestT = 0;
for (var i = 0; i < files_.length; i++) {
    if (files_[i].getName().indexOf("result_success") >= 0 && files_[i].lastModified() > latestT) {
        latestT = files_[i].lastModified(); latest = files_[i].getAbsolutePath();
    }
}
logger.info("testing: " + latest);
var b64 = scenes._fitBase64(latest);
logger.info("final b64 chars: " + (b64 ? b64.length : "null"));
