// main.js - 桌面入口: AutoJs6 -> 文件 -> attendance-checkin-k40 -> 运行本文件
// 等价于 一键打卡.js: 完整流程 + 结果 toast
"auto";
var logger = require("./lib/logger.js");
logger.init();
files.createWithDirs("/sdcard/checkin/autojs/state/");
try { files.remove("/sdcard/checkin/autojs/scene.args"); } catch (e) {}

logger.info("====== 手动打卡 (main.js) ======");

var a11y = require("./a11y_guard.js");
if (!a11y.ensure(25000)) {
    toastLog("无障碍服务异常, 无法打卡\n请检查AutoJs6无障碍设置");
    sleep(5000);
    exit(1);
}

var scenes = require("./scenes.js");
var r = scenes.all();

var names = ["launch", "nav", "attendance", "login", "getcode", "ppapi", "inputcode", "submit", "result"];
var failed = null;
for (var i = 0; i < names.length; i++) {
    if (!r[names[i]] || !r[names[i]].ok) { failed = names[i]; break; }
}

if (failed === null) {
    toastLog("✅ 打卡成功!\n结果已推送微信, 查收截图");
} else if (r.attendance && r.attendance.restDay) {
    toastLog("🌅 今天休息, 无需打卡");
} else {
    toastLog("❌ 打卡在 " + failed + " 环节失败\n重跑一次通常可恢复\n详见 /sdcard/checkin/autojs/log.txt");
}
sleep(8000);
