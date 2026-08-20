/**
 * STK Trigger - AutoJS6 script
 *
 * Monitors pushplus message list for trigger keyword.
 * When triggered, waits for com.android.stk StkInputActivity and inputs code.
 *
 * === Trigger format ===
 * Send via pushplus with title "STK_TRIGGER" -> uses default code 111111111
 * Send via pushplus with title "STK_TRIGGER:123456" -> uses custom code
 *
 * Trigger only valid within 2 minutes of message updateTime.
 *
 * === Send trigger ===
 * Browser: https://www.pushplus.plus/send?token=821c4bffa77242268d9664c3e3a24cce&title=STK_TRIGGER&content=go
 * Or SMS to phone (pushplus will forward) with content "STK_TRIGGER"
 */

// ===== Config =====
var PP_TOKEN = "821c4bffa77242268d9664c3e3a24cce";
var PP_SECRET = "ogIU753RWNhMVOdUMn-3gHm4LvRI";
var PP_API_BASE = "https://www.pushplus.plus";
var TRIGGER_KEYWORD = "STK_TRIGGER";
var DEFAULT_CODE = "111111111";
var POLL_INTERVAL = 15000;      // ms between pushplus polls
var STK_WAIT_TIMEOUT = 60000;   // ms to wait for STK after trigger
var STK_CHECK_INTERVAL = 1000;  // ms between STK foreground checks
var TRIGGER_WINDOW = 120000;    // ms (2 min) - ignore trigger older than this

// ===== State =====
var accessKey = "";
var baselineShortCode = "";

// ===== Logging =====
function log(msg) {
    var ts = new Date().toLocaleString("zh-CN");
    console.log("[" + ts + "] " + msg);
}

// ===== PushPlus API =====
function getAccessKey() {
    try {
        var resp = http.postJson(PP_API_BASE + "/api/common/openApi/getAccessKey", {
            token: PP_TOKEN,
            secretKey: PP_SECRET
        });
        var body = resp.body.json();
        if (body && body.data && body.data.accessKey) {
            return body.data.accessKey;
        }
        log("getAccessKey: unexpected response: " + JSON.stringify(body));
        return "";
    } catch (e) {
        log("getAccessKey error: " + e);
        return "";
    }
}

function fetchLatestMessage() {
    if (!accessKey) {
        accessKey = getAccessKey();
        if (!accessKey) return null;
    }
    try {
        var resp = http.postJson(PP_API_BASE + "/api/open/message/list", {
            current: 1,
            pageSize: 5
        }, {
            headers: { "access-key": accessKey }
        });
        var body = resp.body.json();
        if (body && body.code === 40) {
            log("accessKey expired, refreshing...");
            accessKey = getAccessKey();
            if (!accessKey) return null;
            resp = http.postJson(PP_API_BASE + "/api/open/message/list", {
                current: 1,
                pageSize: 5
            }, {
                headers: { "access-key": accessKey }
            });
            body = resp.body.json();
        }
        if (body && body.data && body.data.list && body.data.list.length > 0) {
            return body.data.list;
        }
        return [];
    } catch (e) {
        log("fetchLatestMessage error: " + e);
        return null;
    }
}

// Parse pushplus updateTime "2026-08-19 17:44:16" to epoch ms
function parseUpdateTime(str) {
    var parts = str.split(/[- :]/);
    if (parts.length < 6) return 0;
    var d = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
    return d.getTime();
}

// ===== Trigger detection =====
// Returns the input code if trigger found (and within 2min window), "" otherwise.
function checkTrigger(messages) {
    var newCount = 0;
    var triggerFound = false;
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var title = msg.title || "";
        var sc = msg.shortCode || "";
        if (sc === baselineShortCode) continue;
        newCount++;
        var idx = title.indexOf(TRIGGER_KEYWORD);
        if (idx >= 0) {
            triggerFound = true;
            log(">>> PUSHPLUS TRIGGER HIT <<<");
            log("    title: " + title);
            log("    shortCode: " + sc);
            log("    updateTime: " + (msg.updateTime || "unknown"));
            var msgTime = parseUpdateTime(msg.updateTime || "");
            if (msgTime > 0 && (Date.now() - msgTime) > TRIGGER_WINDOW) {
                var age = Math.round((Date.now() - msgTime) / 1000);
                log("    [EXPIRED] age=" + age + "s > " + (TRIGGER_WINDOW / 1000) + "s, skipping");
                continue;
            }
            var ageStr = msgTime > 0 ? Math.round((Date.now() - msgTime) / 1000) + "s" : "unknown";
            log("    [VALID] age=" + ageStr + ", within " + (TRIGGER_WINDOW / 1000) + "s window");
            var after = title.substring(idx + TRIGGER_KEYWORD.length);
            if (after.indexOf(":") === 0 && after.length > 1) {
                var code = after.substring(1).trim();
                if (code.length > 0) {
                    log("    [CODE] " + code + " (custom)");
                    return code;
                }
            }
            log("    [CODE] " + DEFAULT_CODE + " (default)");
            return DEFAULT_CODE;
        }
    }
    if (newCount > 0 && !triggerFound) {
        log("poll ok: " + newCount + " new msg(s), none matched '" + TRIGGER_KEYWORD + "'");
    }
    return "";
}

// ===== STK foreground detection =====
// Quiet check + log foreground every N calls to reduce noise
function isStkForegroundSparse(checkCount) {
    try {
        var pkg = currentPackage();
        if (checkCount % 5 === 0) {
            if (pkg) {
                log("    [check #" + checkCount + "] foreground: " + pkg + (pkg.indexOf("com.android.stk") >= 0 ? " [STK!]" : " [not STK]"));
            } else {
                log("    [check #" + checkCount + "] foreground: null");
            }
        }
        if (pkg && pkg.indexOf("com.android.stk") >= 0) {
            return true;
        }
    } catch (e) {
       log("    currentPackage() error: " + e);
    }
    return false;
}

// ===== Input + confirm =====
function doStkInput(code) {
    log("====== TRIGGER RECEIVED ======");
    log("  --- READINESS CHECK ---");
    log("    [OK] pushplus trigger  : HIT");
    log("    [OK] time window       : VALID (within " + (TRIGGER_WINDOW / 1000) + "s)");
    log("    [OK] input code        : " + code);
    log("    [OK] foreground detect : working");
    log("    [--] STK popup         : NOT YET");
    log("  ==========================");
    log("  >>> ALL READY - only STK popup remaining <<<");
    log("  >>> STK uses are limited, will input code when STK appears <<<");
    log("  timeout: " + (STK_WAIT_TIMEOUT / 1000) + "s");
    var deadline = Date.now() + STK_WAIT_TIMEOUT;
    var checkCount = 0;
    while (Date.now() < deadline) {
        checkCount++;
        if (isStkForegroundSparse(checkCount)) {
            log("  >>> STK DETECTED (check #" + checkCount + "), inputting code now <<<");
            click(600, 353);
            sleep(300);
            setText(code);
            sleep(300);
            click(720, 492);
            log("  >>> INPUT DONE: code=" + code + ", confirm clicked <<<");
            sleep(1000);
            return true;
        }
        sleep(STK_CHECK_INTERVAL);
    }
    log("  !!! TIMEOUT: STK NOT APPEARED after " + checkCount + " checks (" + (STK_WAIT_TIMEOUT / 1000) + "s)");
    log("  !!! Pushplus trigger was OK, code was ready [" + code + "]");
    log("  !!! ONLY the STK popup did not appear - everything else passed");
    log("  !!! If STK was expected, check SIM/STK settings on device");
    return false;
}

// ===== Main loop =====
function main() {
    log("=== STK Trigger started ===");
    log("  poll: every " + (POLL_INTERVAL / 1000) + "s");
    log("  trigger window: " + (TRIGGER_WINDOW / 1000) + "s");
    log("  stk wait: " + (STK_WAIT_TIMEOUT / 1000) + "s");
    log("  keyword: '" + TRIGGER_KEYWORD + "'");

    accessKey = getAccessKey();
    if (!accessKey) {
        log("FATAL: cannot get accessKey, retry in 30s");
        sleep(30000);
        accessKey = getAccessKey();
        if (!accessKey) {
            log("FATAL: accessKey failed again, exiting");
            return;
        }
    }
    log("accessKey obtained");

    var msgs = fetchLatestMessage();
    if (msgs && msgs.length > 0) {
        baselineShortCode = msgs[0].shortCode || "";
        log("baseline shortCode: " + baselineShortCode);
    } else {
        log("no existing messages, baseline empty");
    }

    while (true) {
        var messages = fetchLatestMessage();
        if (messages && messages.length > 0) {
            var newestSc = messages[0].shortCode || "";
            var code = checkTrigger(messages);
            if (code) {
                doStkInput(code);
                baselineShortCode = newestSc;
                log("=== trigger cycle complete, resuming polling ===");
            } else if (newestSc !== baselineShortCode) {
                baselineShortCode = newestSc;
                log("new msg (not trigger), baseline updated: " + baselineShortCode);
            }
        }
        sleep(POLL_INTERVAL);
    }
}

main();
