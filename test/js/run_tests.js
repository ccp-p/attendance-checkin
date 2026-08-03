/**
 * Test suite for lib/sms.js (extractCode) and lib/flow.js (detectState).
 *
 * Run with:
 *     node test/js/run_tests.js
 *
 * No external dependencies - uses only Node.js built-in assert.
 * AutoJS6 modules load fine in Node.js because they only call
 * Android/AutoJS6 APIs inside method bodies, not at module load time.
 */

var assert = require("assert");

// ------------------------------------------------------------------
// load actual project modules
// ------------------------------------------------------------------
var sms = require("../../lib/sms.js");
var ui = require("../../lib/ui.js");
var flow = require("../../lib/flow.js");
var config = require("../../config.js");

// ------------------------------------------------------------------
// simple test runner
// ------------------------------------------------------------------
var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        process.stdout.write(".");
    } catch (e) {
        failed++;
        failures.push({ name: name, error: e });
        process.stdout.write("F");
    }
}

function eq(actual, expected, msg) {
    assert.strictEqual(actual, expected, msg);
}

function ok(val, msg) {
    assert.ok(val, msg);
}

// ------------------------------------------------------------------
// sms.extractCode tests
// ------------------------------------------------------------------
var ec = sms.extractCode;

test("standard format", function () {
    eq(ec("\u9a8c\u8bc1\u7801\u4e3a123456"), "123456");
});

test("with colon", function () {
    eq(ec("\u9a8c\u8bc1\u7801: 123456"), "123456");
});

test("with fullwidth colon", function () {
    eq(ec("\u9a8c\u8bc1\u7801\uff1a123456"), "123456");
});

test("with shi", function () {
    eq(ec("\u9a8c\u8bc1\u7801\u662f123456"), "123456");
});

test("dongtaima", function () {
    eq(ec("\u52a8\u6001\u7801:123456"), "123456");
});

test("code not supported format", function () {
    // "code is X" not supported - regex only handles whitespace/colon separators
    eq(ec("Your code is 123456"), null);
});

test("code colon", function () {
    eq(ec("code:123456"), "123456");
});

test("code case insensitive", function () {
    eq(ec("CODE:123456"), "123456");
});

test("code with spaces", function () {
    eq(ec("code 123456"), "123456");
});

test("min 4 digits", function () {
    eq(ec("\u9a8c\u8bc1\u7801\u4e3a1234"), "1234");
});

test("max 8 digits", function () {
    eq(ec("\u9a8c\u8bc1\u7801\u4e3a12345678"), "12345678");
});

test("too few digits returns null", function () {
    eq(ec("\u9a8c\u8bc1\u7801\u4e3a123"), null);
});

test("no keyword returns null", function () {
    eq(ec("hello world 123456"), null);
});

test("empty string returns null", function () {
    eq(ec(""), null);
});

test("null input returns null", function () {
    eq(ec(null), null);
});

test("in long text", function () {
    var text = "\u3010\u4e2d\u56fd\u79fb\u52a8\u3011\u60a8\u7684\u9a8c\u8bc1\u7801\u4e3a123456\uff0c\u8bf7\u4e8e5\u5206\u949f\u5185\u4f7f\u7528";
    eq(ec(text), "123456");
});

test("multiple numbers - extracts code not other numbers", function () {
    var text = "\u9a8c\u8bc1\u7801\u4e3a123456\uff0c\u6709\u6548\u671f30\u79d2";
    eq(ec(text), "123456");
});

test("code after keyword", function () {
    var text = "\u6709\u6548\u671f30\u79d2\uff0c\u9a8c\u8bc1\u7801\u4e3a123456";
    eq(ec(text), "123456");
});

test("real pushplus message", function () {
    var text = "\u3010\u4e2d\u56fd\u79fb\u52a8\u3011\u60a8\u7684\u9a8c\u8bc1\u7801\u4e3a262400\uff0c\u8bf7\u57285\u5206\u949f\u5185\u5b8c\u6210\u9a8c\u8bc1";
    eq(ec(text), "262400");
});


// ------------------------------------------------------------------
// flow.detectState tests
// ------------------------------------------------------------------
// detectState uses:
//   - currentPackage()  (AutoJS6 global)
//   - ui.collectAllTexts()  (returns array of strings)
// We can override both since flow holds a reference to the same ui object.

var savedCollectAllTexts = ui.collectAllTexts;
var savedCurrentPackage = global.currentPackage;

function setScreen(texts) {
    ui.collectAllTexts = function () { return texts; };
}

function setPackage(pkg) {
    global.currentPackage = function () { return pkg; };
}

// default: in-app
setPackage(config.appPackage);

test("not_in_app", function () {
    setPackage("com.other.app");
    setScreen([]);
    eq(flow.detectState(), "not_in_app");
    setPackage(config.appPackage);
});

test("attendance page", function () {
    setScreen([config.text.checkin, config.text.attendance]);
    eq(flow.detectState(), "attendance");
});

test("login_phone with getcode", function () {
    setScreen([config.text.getCode, config.text.smsLogin]);
    eq(flow.detectState(), "login_phone");
});

test("code_countdown (59s)", function () {
    setScreen([config.text.smsLogin, "59s"]);
    eq(flow.detectState(), "code_countdown");
});

test("code_countdown (reget)", function () {
    setScreen([config.text.smsLogin, "\u91cd\u65b0\u83b7\u53d6"]);
    eq(flow.detectState(), "code_countdown");
});

test("code_countdown (refa)", function () {
    setScreen([config.text.smsLogin, "\u91cd\u53d1"]);
    eq(flow.detectState(), "code_countdown");
});

test("login_phone sms only", function () {
    setScreen([config.text.smsLogin]);
    eq(flow.detectState(), "login_phone");
});

test("workbench", function () {
    setScreen([config.text.attendance, config.text.tabWorkbench]);
    eq(flow.detectState(), "workbench");
});

test("home", function () {
    setScreen([config.text.tabWorkbench]);
    eq(flow.detectState(), "home");
});

test("unknown", function () {
    setScreen(["some random text"]);
    eq(flow.detectState(), "unknown");
});

test("attendance priority over workbench", function () {
    setScreen([config.text.checkin, config.text.attendance]);
    eq(flow.detectState(), "attendance");
});

test("getcode priority over countdown", function () {
    setScreen([config.text.getCode, config.text.smsLogin, "59s"]);
    eq(flow.detectState(), "login_phone");
});

test("notification texts no false positive", function () {
    setScreen([
        "11:15",
        "\u7535\u6c60\u72b6\u6001\u9879\u76ee \u5145\u7535\u4e2d, \u5269\u4f59\u7535\u91cf\u767e\u5206\u4e4b85",
        "\u7f51\u901f \u72b6\u6001\u680f\u9879\u76ee 948 KB/s",
        config.text.tabWorkbench,
    ]);
    eq(flow.detectState(), "home");
});


// ------------------------------------------------------------------
// config consistency tests (Python vs JS)
// ------------------------------------------------------------------
test("config appPackage matches", function () {
    eq(config.appPackage, "com.cmri.ercs.yqx");
});

test("config phoneInput matches", function () {
    eq(config.phoneInput, "2449");
});

test("config text keys complete", function () {
    var keys = [
        "tabWorkbench", "attendance", "checkin", "smsLogin",
        "getCode", "codeExpired", "pushplus", "viewDetail",
        "trustedAuth", "cancel",
    ];
    for (var i = 0; i < keys.length; i++) {
        ok(config.text[keys[i]], "Missing or empty text key: " + keys[i]);
    }
});


// ------------------------------------------------------------------
// restore mocks
// ------------------------------------------------------------------
ui.collectAllTexts = savedCollectAllTexts;
if (savedCurrentPackage) {
    global.currentPackage = savedCurrentPackage;
} else {
    delete global.currentPackage;
}


// ------------------------------------------------------------------
// summary
// ------------------------------------------------------------------
console.log("");
console.log(passed + " passed, " + failed + " failed");
if (failed > 0) {
    console.log("");
    failures.forEach(function (f) {
        console.log("  FAIL: " + f.name);
        console.log("    " + f.error.message);
    });
    process.exit(1);
} else {
    console.log("All tests passed!");
}
