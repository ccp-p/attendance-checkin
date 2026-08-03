// ============================================================
//  attendance checkin config (calibrated on real device)
//  device: OPPO PJZ110  1080x2376
//  app package: com.cmri.ercs.yqx
// ============================================================
var config = {
    appName: "移动办公",
    appPackage: "com.cmri.ercs.yqx",
    wechatPackage: "com.tencent.mm",

    phoneNumber: "134xxxxx708",
    // login page uses a custom number pad, only need last 4 digits
    phoneInput: "2449",

    text: {
        tabWorkbench: "工作台",
        attendance: "考勤打卡",
        checkin: "签到",
        smsLogin: "短信验证码登录",
        getCode: "获取验证码",
        codeExpired: "短信验证码过期或不存在",
        pushplus: "pushplus",
        viewDetail: "查看详情",
        trustedAuth: "可信认证",
        cancel: "取消"
    },

    timeout: {
        findElement: 10000,
        waitForCode: 60000,
        pageLoad: 3000,
        appLaunch: 5000,
        pushplusDelay: 6000
    },

    schedule: {
        enabled: false,
        times: ["07:20", "17:30"],
        checkIntervalSec: 30
    },

    logFile: "/sdcard/attendance_checkin/log.txt",
    maxLogSize: 2097152
};

module.exports = config;
