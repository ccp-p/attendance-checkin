// ============================================================
//  attendance checkin config - k40 (M2012K11AC, Android 13, root)
//  migrated from OnePlus PJZ110 AutoJs6 project
// ============================================================
var config = {
    appName: "办公应用",
    appPackage: "com.cmri.ercs.yqx",
    wechatPackage: "com.tencent.mm",

    // login page uses a custom number pad, only need last 4 digits
    phoneInput: "2449",

    // pushplus open API (SMS->WeChat->pushplus forwarding)
    // polling the message list is far more reliable than parsing WeChat UI
    ppToken: "YOUR_PP_TOKEN",
    ppSecretKey: "YOUR_PP_SECRET",
    ppApiBase: "https://www.pushplus.plus",
    // NOTE: trailing slash on message/list is REQUIRED - nginx 403s the
    // non-slash path (2026-09-28). getAccessKey has no trailing slash.
    ppListPath: "/api/open/message/list/",
    ppPollIntervalMs: 5000,
    ppWaitForCodeMs: 210000,

    text: {
        tabWorkbench: "工作台",
        attendance: "考勤打卡",
        checkin: "签到",
        checkout: "签退",
        smsLogin: "短信验证码登录",
        getCode: "获取验证码",
        codeExpired: "短信验证码过期或不存在",
        viewDetail: "查看详情",
        trustedAuth: "可信认证",
        trustedAuthPlatform: "可信认证平台",
        cancel: "取消",
        locationError: "位置信息获取失败",
        confirm: "确认",
        checkinSuccess: "打卡成功",
        signinSuccess: "签到成功",
        checkoutSuccess: "签退成功"
    },

    timeout: {
        findElement: 10000,
        waitForCode: 210000,
        pageLoad: 3000,
        appLaunch: 5000
    },

    logFile: "/sdcard/checkin/autojs/log.txt",
    maxLogSize: 2097152,

    // scene state dir: each scene persists its output for the next scene
    stateDir: "/sdcard/checkin/autojs/state/",

    schedule: {
        times: ["07:20", "17:30"],
        checkIntervalSec: 30,
        retryCount: 3,
        retryDelaySec: 120
    }
};

module.exports = config;
