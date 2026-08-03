var config = require("../config.js");
var logger = require("./logger.js");
var ui = require("./ui.js");
var sms = require("./sms.js");

// 打卡流程编排 (已根据真机实测校准)
var flow = {

    // 启动移动办公
    launchApp: function () {
        logger.info("启动应用: " + config.appName);
        app.launchPackage(config.appPackage);
        sleep(config.timeout.appLaunch);
        logger.info("当前包名: " + currentPackage());
    },

    // 步骤1: 点击底部 tab「工作台」
    goToWorkbench: function () {
        logger.info("切换到工作台 tab");
        if (ui.clickAny(config.text.tabWorkbench, config.timeout.findElement)) {
            sleep(config.timeout.pageLoad);
            return true;
        }
        return false;
    },

    // 步骤2: 找到并点击「考勤打卡」
    openAttendance: function () {
        logger.info("查找考勤打卡入口");
        if (ui.clickAny(config.text.attendance, config.timeout.findElement)) {
            sleep(config.timeout.pageLoad);
            return true;
        }
        // 工作台内容多,需要滚动
        if (ui.scrollToFind(config.text.attendance)) {
            if (ui.clickAny(config.text.attendance, 5000)) {
                sleep(config.timeout.pageLoad);
                return true;
            }
        }
        return false;
    },

    // 步骤3: 点击 webview 里的「签到」
    // 实测: "签到"文字本身不可点击,需要点它的父容器(可点击区域)
    // webview 加载慢,需要轮询等待签到出现
    doCheckin: function () {
        logger.info("查找签到按钮(webview 可能需要加载)");
        var maxRetry = 6;
        for (var i = 0; i < maxRetry; i++) {
            var node = text(config.text.checkin).findOne(10000);
            if (node) {
                var b = node.bounds();
                click(b.centerX(), b.centerY());
                logger.info("点击签到坐标: " + b.centerX() + "," + b.centerY() + " (第" + (i+1) + "次尝试)");
                sleep(config.timeout.pageLoad);
                return true;
            }
            logger.warn("第" + (i+1) + "次未找到签到,等待页面加载后重试");
            sleep(3000);
        }
        logger.error("重试 " + maxRetry + " 次仍未找到签到按钮");
        return false;
    },

    // 步骤4: 用自定义数字键盘输入 2449
    // 实测: 登录页是自定义数字键盘(不是 EditText),需要逐个点击数字
    inputPhone: function () {
        logger.info("输入手机号片段: " + config.phoneInput);
        var digits = config.phoneInput.split("");
        for (var i = 0; i < digits.length; i++) {
            var node = text(digits[i]).findOne(5000);
            if (node) {
                var b = node.bounds();
                click(b.centerX(), b.centerY());
                logger.info("点击数字 " + digits[i]);
                sleep(500);
            } else {
                logger.warn("未找到数字键: " + digits[i]);
            }
        }
        sleep(1000);
    },

    // 步骤5: 点击「短信验证码登录」(切换到短信模式后等待获取验证码按钮出现)
    clickSmsLogin: function () {
        logger.info("点击短信验证码登录");
        if (!ui.clickAny(config.text.smsLogin, config.timeout.findElement)) return false;
        for (var i = 0; i < 10; i++) {
            sleep(1000);
            var texts = ui.collectAllTexts();
            if (texts.join(" ").indexOf(config.text.getCode) >= 0) {
                logger.info("获取验证码按钮已出现 (" + (i+1) + "s后)");
                return true;
            }
        }
        logger.warn("获取验证码按钮未出现");
        return true;
    },

    // 签到后等待登录页加载(webview 加载慢)
    waitForLoginPage: function (timeoutMs) {
        timeoutMs = timeoutMs || 20000;
        logger.info("等待登录页加载...");
        var deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            var texts = ui.collectAllTexts();
            var allText = texts.join(" ");
            if (allText.indexOf(config.text.getCode) >= 0 || allText.indexOf(config.text.smsLogin) >= 0) {
                logger.info("登录页已加载");
                return true;
            }
            sleep(1000);
        }
        logger.warn("登录页未在超时内加载");
        return false;
    },

    // 步骤6: 点击「获取验证码」
    requestCode: function () {
        logger.info("点击获取验证码");
        ui.clickAny(config.text.getCode, config.timeout.findElement);
        sleep(2000);
    },

    // 步骤7: 从 pushplus 微信取验证码
    retrieveCode: function () {
        logger.info("等待 pushplus 转发验证码...");
        sleep(config.timeout.pushplusDelay);
        var code = sms.retrieve(config.timeout.waitForCode);
        if (code) {
            logger.ok("取得验证码: " + code);
        } else {
            logger.error("未能获取验证码");
        }
        return code;
    },

    // 步骤8: 切回移动办公并输入验证码
    inputCode: function (code) {
        logger.info("切回移动办公并输入验证码");
        app.launchPackage(config.appPackage);
        sleep(config.timeout.appLaunch);

        // 点 EditText 并输入验证码
        var et = className("android.widget.EditText").findOne(5000);
        if (et) {
            et.click();
            sleep(300);
            et.setText(code);
            logger.info("验证码已填入 EditText");
        } else {
            setText(code);
            logger.info("验证码用 setText 兜底填入");
        }
        sleep(1000);

        // 收起键盘 - 实测必须先收键盘才能看到登录按钮
        ui.hideKeyboard();
    },

    // 步骤9: 点击「短信验证码登录」完成登录
    clickCodeLogin: function () {
        logger.info("点击短信验证码登录(提交)");
        ui.clickAny(config.text.smsLogin, config.timeout.findElement);
        sleep(config.timeout.pageLoad);
    },

    // 步骤10: 检测并处理「可信认证」弹窗(随机出现,webview)
    handleTrustedAuth: function () {
        logger.info("检测可信认证(随机弹窗)...");
        for (var i = 0; i < 6; i++) {
            var texts = ui.collectAllTexts();
            var allText = texts.join(" ");
            if (allText.indexOf(config.text.trustedAuth) >= 0) {
                logger.warn("检测到可信认证! 尝试点击取消");
                // 策略1: 直接点文字
                if (ui.clickText(config.text.cancel, 5000)) {
                    logger.ok("已点击取消(文字匹配)");
                    sleep(config.timeout.pageLoad);
                    return true;
                }
                // 策略2: 包含文字
                if (ui.clickTextContains(config.text.cancel, 5000)) {
                    logger.ok("已点击取消(包含文字)");
                    sleep(config.timeout.pageLoad);
                    return true;
                }
                // 策略3: 找节点点中心坐标
                var node = text(config.text.cancel).findOne(5000);
                if (node) {
                    var b = node.bounds();
                    click(b.centerX(), b.centerY());
                    logger.ok("已点击取消(坐标) " + b.centerX() + "," + b.centerY());
                    sleep(config.timeout.pageLoad);
                    return true;
                }
                logger.error("可信认证已出现但未找到取消按钮");
                return false;
            }
            sleep(3000);
        }
        logger.info("未检测到可信认证(正常路径)");
        return false;
    },

    // 检查是否登录成功
    checkResult: function () {
        var texts = ui.collectAllTexts();
        var allText = texts.join(" ");
        if (allText.indexOf(config.text.codeExpired) >= 0) {
            logger.error("验证码过期");
            return false;
        }
        // 登录成功后登录弹窗消失,显示签到状态
        // login dialog disappears = login success (no more login button or SIM auth text)
        if (allText.indexOf("短信验证码登录") < 0 && allText.indexOf("使用SIM卡认证") < 0) {
            logger.ok("登录弹窗已消失,可能登录成功");
            return true;
        }
        logger.warn("无法确认登录状态");
        return false;
    },

    // 检测当前页面状态,返回状态名
    detectState: function () {
        var pkg = currentPackage();
        var texts = ui.collectAllTexts();
        var allText = texts.join(" ");

        if (pkg != config.appPackage) return "not_in_app";



        if (allText.indexOf(config.text.checkin) >= 0) return "attendance";

        // 获取验证码按钮可见:需要输入手机号+请求验证码
        if (allText.indexOf(config.text.getCode) >= 0) return "login_phone";

        // 倒数中(验证码已发送,按钮已变倒数)
        if (allText.indexOf(config.text.smsLogin) >= 0 && (/\d{1,2}s/.test(allText) || allText.indexOf("重新获取") >= 0 || allText.indexOf("重发") >= 0)) return "code_countdown";

        // 短信登录可见但获取验证码按钮不在( getCode 点击短信登录后才出现)
        if (allText.indexOf(config.text.smsLogin) >= 0) return "login_phone";

        if (allText.indexOf(config.text.attendance) >= 0) return "workbench";

        if (allText.indexOf(config.text.tabWorkbench) >= 0) return "home";

        return "unknown";
    },

    // 完整流程(根据当前页面状态接续)
    run: function () {
        logger.info("======== 开始打卡流程 ========");
        try {
            var state = this.detectState();
            logger.info("检测到状态: " + state);

            if (state == "not_in_app" || state == "unknown") {
                this.launchApp();
                // 等待 App 加载,轮询检测最多 5 次
                for (var i = 0; i < 5; i++) {
                    sleep(3000);
                    state = this.detectState();
                    logger.info("启动后状态: " + state);
                    if (state != "unknown") break;
                }
            }

            if (state == "home") {
                if (!this.goToWorkbench()) { logger.error("未进入工作台"); return false; }
                state = this.detectState();
            }

            if (state == "workbench") {
                if (!this.openAttendance()) { logger.error("未打开考勤打卡"); return false; }
                state = this.detectState();
            }

            if (state == "attendance") {
                if (!this.doCheckin()) { logger.error("签到失败,终止流程"); return false; }
                this.waitForLoginPage(20000);
                state = this.detectState();
                logger.info("签到后状态: " + state);
            }

            // 守卫:必须在登录页面才能继续
            if (state != "login_phone" && state != "code_countdown") {
                logger.error("意外状态: " + state + ",无法继续");
                return false;
            }

            // --- 登录阶段:顺序执行,不跳转 ---
            if (state == "login_phone") {
                this.inputPhone();
                var texts = ui.collectAllTexts();
                if (texts.join(" ").indexOf(config.text.getCode) < 0) {
                    this.clickSmsLogin();
                } else {
                    logger.info("获取验证码已可见,跳过短信登录点击");
                }
                if (!this.requestCode()) { logger.error("获取验证码失败,终止流程"); return false; }
            }

            // 取码 -> 输入 -> 提交 -> 可信认证 -> 检查
            var code = this.retrieveCode();
            if (!code) return false;
            this.inputCode(code);
            this.clickCodeLogin();
            this.handleTrustedAuth();
            var ok = this.checkResult();
            if (ok) {
                logger.ok("======== 打卡流程完成 ========");
            } else {
                logger.warn("流程执行完毕但结果不确定,请检查日志");
            }
            return ok;
        } catch (e) {
            logger.error("流程异常: " + e);
            return false;
        }
    }
};

module.exports = flow;
