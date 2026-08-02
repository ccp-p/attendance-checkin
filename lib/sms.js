var config = require("../config.js");
var logger = require("./logger.js");
var ui = require("./ui.js");

// verification code retrieval
// path: open notification bar -> tap pushplus -> WeChat chat -> tap "查看详情" -> read webview
var sms = {

    extractCode: function (txt) {
        if (!txt) return null;
        var patterns = [
            /验证码为(\d{4,8})/,
            /验证码[\s::为是]*(\d{4,8})/,
            /动态码[\s::为是]*(\d{4,8})/,
            /code[\s::]*(\d{4,8})/i,
            /\b(\d{6})\b/,
            /\b(\d{4})\b/
        ];
        for (var i = 0; i < patterns.length; i++) {
            var m = txt.match(patterns[i]);
            if (m) return m[1];
        }
        return null;
    },

    retrieve: function (timeoutMs) {
        var deadline = Date.now() + (timeoutMs || config.timeout.waitForCode);

        // 1. open notification bar - swipe down from left side (OPPO ColorOS: left=notifications, right=control center)
        logger.info("swipe down from left to open notification bar");
        var w = device.width;
        var h = device.height;
        gesture(500, [w * 0.2, 0], [w * 0.2, h / 2]);
        sleep(2000);

        // 2. find pushplus notification
        var clicked = false;
        for (var attempt = 0; attempt < 5 && Date.now() < deadline; attempt++) {
            logger.info("searching pushplus in notification (attempt " + (attempt + 1) + ")");
            // try textContains
            var node = textContains(config.text.pushplus).findOne(5000);
            if (node) {
                logger.info("found pushplus, clicking");
                node.click() || (function () {
                    var b = node.bounds();
                    click(b.centerX(), b.centerY());
                })();
                clicked = true;
                break;
            }
            sleep(2000);
        }

        if (!clicked) {
            logger.warn("pushplus not in notification bar, opening WeChat directly");
            // close notification bar first
            gesture(500, [w * 0.2, h / 2], [w * 0.2, 0]);
            sleep(1000);

            // open WeChat
            app.launchPackage(config.wechatPackage);
            sleep(3000);
            logger.info("opened WeChat, package: " + currentPackage());

            // try to find pushplus chat in recent chats
            // search for pushplus in chat list
            var chatNode = textContains(config.text.pushplus).findOne(5000);
            if (chatNode) {
                logger.info("found pushplus in chat list, clicking");
                chatNode.click() || (function () {
                    var b = chatNode.bounds();
                    click(b.centerX(), b.centerY());
                })();
                sleep(2000);
            } else {
                // use WeChat search to find pushplus service account
                logger.info("using WeChat search to find pushplus");
                var searchNode = desc("搜索").findOne(5000);
                if (searchNode) {
                    searchNode.click();
                    sleep(1000);
                    setText("pushplus");
                    sleep(2000);
                    // click search result
                    var result = textContains("pushplus").findOne(5000);
                    if (result) {
                        result.click() || (function () {
                            var b = result.bounds();
                            click(b.centerX(), b.centerY());
                        })();
                        sleep(2000);
                    }
                }
            }
        } else {
            sleep(2000);
        }

        logger.info("current package: " + currentPackage());

        // 3. in WeChat chat page, find last "查看详情"
        var code = null;
        for (var i = 0; i < 10 && Date.now() < deadline; i++) {
            var count = ui.countText(config.text.viewDetail);
            logger.info("查看详情 count: " + count + " (attempt " + (i + 1) + ")");

            if (count > 0) {
                // click the last one (newest message)
                ui.clickLastText(config.text.viewDetail, 5000);
                sleep(4000);

                // 4. read code from webview
                code = this.fromScreen();
                if (code) {
                    logger.ok("got code from pushplus webview: " + code);
                    return code;
                }

                // not found, go back and try next
                logger.info("code not found in webview, go back");
                back();
                sleep(2000);
            } else {
                // maybe pushplus message not arrived yet, wait
                logger.info("waiting for pushplus message...");
                sleep(3000);
            }
        }

        // 5. fallback: read current screen
        if (!code) {
            code = this.fromScreen();
            if (code) logger.ok("fallback screen code: " + code);
        }

        if (!code) logger.error("failed to get verification code");
        return code;
    },

    fromScreen: function () {
        var texts = ui.collectAllTexts();
        for (var i = 0; i < texts.length; i++) {
            var code = this.extractCode(texts[i]);
            if (code) return code;
        }
        return null;
    }
};

module.exports = sms;
