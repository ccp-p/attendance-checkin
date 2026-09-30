"auto";
files.write("/sdcard/attendance_checkin/simple_test.txt", "script started\n");
try {
var m = require("./test_mod.js");
files.append("/sdcard/attendance_checkin/simple_test.txt", "ok: " + m.hello() + "\n");
} catch(e) {
files.append("/sdcard/attendance_checkin/simple_test.txt", "ERR: " + e + "\n");
}