var logger = require("./logger.js");

// UI 交互辅助 - 基于 AutoJS6 无障碍服务 API
var ui = {
    // 按精确文字查找节点
    findByText: function (txt, timeout) {
        return text(txt).findOne(timeout || 10000);
    },

    // 按包含文字查找
    findByContains: function (txt, timeout) {
        return textContains(txt).findOne(timeout || 10000);
    },

    // 按描述(desc)查找
    findByDesc: function (txt, timeout) {
        return desc(txt).findOne(timeout || 10000);
    },

    // 点节点中心坐标(click() 返回 false 时坐标兜底)
    clickNodeCenter: function (node) {
        if (!node) return false;
        var b = node.bounds();
        return click(b.centerX(), b.centerY());
    },

    // 按精确文字点击
    clickText: function (txt, timeout) {
        var node = this.findByText(txt, timeout);
        if (node) {
            var ok = node.click() || this.clickNodeCenter(node);
            logger.info("点击[" + txt + "] -> " + (ok ? "成功" : "失败"));
            return ok;
        }
        logger.warn("未找到文字: " + txt);
        return false;
    },

    // 按包含文字点击
    clickTextContains: function (txt, timeout) {
        var node = this.findByContains(txt, timeout);
        if (node) {
            var ok = node.click() || this.clickNodeCenter(node);
            logger.info("点击(包含)[" + txt + "] -> " + (ok ? "成功" : "失败"));
            return ok;
        }
        logger.warn("未找到包含文字: " + txt);
        return false;
    },

    // 按 desc 点击
    clickDesc: function (txt, timeout) {
        var node = this.findByDesc(txt, timeout);
        if (node) {
            var ok = node.click() || this.clickNodeCenter(node);
            logger.info("点击[desc:" + txt + "] -> " + (ok ? "成功" : "失败"));
            return ok;
        }
        return false;
    },

    // 多策略点击: 文字 -> 包含文字 -> desc
    clickAny: function (label, timeout) {
        if (this.clickText(label, timeout)) return true;
        if (this.clickTextContains(label, 5000)) return true;
        if (this.clickDesc(label, 5000)) return true;
        return false;
    },

    // 点击指定文字的第 index 个实例(0-based),用于多个同名按钮
    clickTextIndex: function (txt, index, timeout) {
        var els = text(txt).find();
        if (els && els.size() > index) {
            var node = els.get(index);
            var ok = node.click() || this.clickNodeCenter(node);
            logger.info("点击[" + txt + " #" + index + "] -> " + (ok ? "成功" : "失败"));
            return ok;
        }
        logger.warn("未找到文字(第" + index + "个): " + txt);
        return false;
    },

    // 获取指定文字节点的数量
    countText: function (txt) {
        var els = text(txt).find();
        return els ? els.size() : 0;
    },

    // 点击最后一个匹配文字的节点(最新的消息)
    clickLastText: function (txt, timeout) {
        var els = text(txt).find();
        if (els && els.size() > 0) {
            var node = els.get(els.size() - 1);
            var ok = node.click() || this.clickNodeCenter(node);
            logger.info("点击最后[" + txt + " #" + (els.size() - 1) + "] -> " + (ok ? "成功" : "失败"));
            return ok;
        }
        logger.warn("未找到文字: " + txt);
        return false;
    },

    // 输入文本到 EditText
    inputText: function (content) {
        var et = className("android.widget.EditText").findOne(5000);
        if (et) {
            et.setText(content);
            logger.info("输入(EditText): " + content);
            return true;
        }
        var ok = setText(content);
        logger.info("输入(setText): " + content + " -> " + (ok ? "成功" : "失败"));
        return ok;
    },

    // 清空并输入
    clearAndInput: function (content) {
        var et = className("android.widget.EditText").findOne(5000);
        if (et) {
            et.setText("");
            sleep(200);
            et.setText(content);
            logger.info("清空后输入: " + content);
            return true;
        }
        return this.inputText(content);
    },

    // 滚动查找
    scrollToFind: function (label) {
        for (var i = 0; i < 4; i++) {
            if (text(label).findOne(2000) || textContains(label).findOne(2000)) {
                return true;
            }
            scrollDown();
            sleep(800);
        }
        return false;
    },

    // 收起输入法键盘(实测必须先收键盘才能看到登录按钮)
    hideKeyboard: function () {
        back();
        sleep(800);
        logger.info("已尝试收起键盘");
    },

    // 收集屏幕上所有文字(含 webview)
    collectAllTexts: function () {
        var all = [];
        var root = auto.rootInActiveWindow;
        if (!root) return all;
        function collect(node) {
            if (!node) return;
            var t = node.text();
            var d = node.desc();
            if (t && t.length > 0) all.push(t);
            if (d && d.length > 0) all.push(d);
            for (var i = 0; i < node.childCount(); i++) {
                collect(node.child(i));
            }
        }
        collect(root);
        return all;
    }
};

module.exports = ui;
