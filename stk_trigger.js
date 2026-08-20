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
var HTTP_CONNECT_TIMEOUT = 10000;  // ms
var HTTP_READ_TIMEOUT = 10000;     // ms
var HTTP_MAX_RETRIES = 3;          // retry count on network error

// ===== State =====
var accessKey = "";
// Time-based dedup: only process messages newer than lastSeenTime.
// On startup, set to (now - TRIGGER_WINDOW) so messages from the last 2 min
// are still processed, but older ones are skipped.
var lastSeenTime = 0;

// ===== Logging =====
function log(msg) {
    var ts = new Date().toLocaleString("zh-CN");
    console.log("[" + ts + "] " + msg);
}

// ===== HTTP (Java HttpURLConnection with explicit timeouts) =====
function httpPost(urlStr, jsonBody, headerMap) {
    var lastErr = "";
    for (var attempt = 1; attempt <= HTTP_MAX_RETRIES; attempt++) {
        try {
            var url = new java.net.URL(urlStr);
            var conn = url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(HTTP_CONNECT_TIMEOUT);
            conn.setReadTimeout(HTTP_READ_TIMEOUT);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            if (headerMap) {
                var keys = Object.keys(headerMap);
                for (var k = 0; k < keys.length; k++) {
                    conn.setRequestProperty(keys[k], headerMap[keys[k]]);
                }
            }
            conn.setDoOutput(true);
            var bodyStr = JSON.stringify(jsonBody);
            var os = conn.getOutputStream();
            os.write(new java.lang.String(bodyStr).getBytes("UTF-8"));
            os.flush();
            os.close();

            var code = conn.getResponseCode();
            var is;
            if (code >= 200 && code < 300) {
                is = conn.getInputStream();
            } else {
                is = conn.getErrorStream();
                if (!is) {
                    lastErr = "HTTP " + code;
                    log("  httpPost attempt " + attempt + ": HTTP " + code);
                    if (attempt < HTTP_MAX_RETRIES) sleep(3000);
                    continue;
                }
            }
            var scanner = new java.util.Scanner(is, "UTF-8").useDelimiter("\\A");
            var respStr = scanner.hasNext() ? scanner.next() : "";
            scanner.close();
            is.close();
            conn.disconnect();
            return JSON.parse(respStr);
        } catch (e) {
            lastErr = String(e);
            if (attempt < HTTP_MAX_RETRIES) {
                log("  httpPost attempt " + attempt + "/" + HTTP_MAX_RETRIES + " failed: " + lastErr + ", retry in 3s");
                sleep(3000);
            } else {
                log("  httpPost FAILED after " + HTTP_MAX_RETRIES + " attempts: " + lastErr);
            }
        }
    }
    return null;
}

// ===== PushPlus API =====
function getAccessKey() {
    var body = httpPost(PP_API_BASE + "/api/common/openApi/getAccessKey", {
        token: PP_TOKEN,
        secretKey: PP_SECRET
    });
    if (body && body.data && body.data.accessKey) {
        return body.data.accessKey;
    }
    log("getAccessKey: unexpected or null response: " + JSON.stringify(body));
    return "";
}

function fetchLatestMessage() {
    if (!accessKey) {
        accessKey = getAccessKey();
        if (!accessKey) return null;
    }
    var body = httpPost(PP_API_BASE + "/api/open/message/list", {
        current: 1,
        pageSize: 5
    }, {
        "access-key": accessKey
    });
    if (!body) return null;
    if (body && body.code === 40) {
        log("accessKey expired, refreshing...");
        accessKey = getAccessKey();
        if (!accessKey) return null;
        body = httpPost(PP_API_BASE + "/api/open/message/list", {
            current: 1,
            pageSize: 5
        }, {
            "access-key": accessKey
        });
        if (!body) return null;
    }
    if (body && body.data && body.data.list && body.data.list.length > 0) {
        return body.data.list;
    }
    return [];
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
// Uses lastSeenTime to skip already-processed messages.
function checkTrigger(messages) {
    var newCount = 0;
    var triggerFound = false;
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var title = msg.title || "";
        var msgTime = parseUpdateTime(msg.updateTime || "");
        // Skip messages already seen (older than or equal to lastSeenTime)
        if (msgTime > 0 && msgTime <= lastSeenTime) continue;
        newCount++;
        var idx = title.indexOf(TRIGGER_KEYWORD);
        if (idx >= 0) {
            triggerFound = true;
            log(">>> PUSHPLUS TRIGGER HIT <<<");
            log("    title: " + title);
            log("    shortCode: " + (msg.shortCode || ""));
            log("    updateTime: " + (msg.updateTime || "unknown"));
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

    // Set lastSeenTime to (now - TRIGGER_WINDOW) so messages from the last 2 min
    // are still processed on startup, but older ones are skipped.
    lastSeenTime = Date.now() - TRIGGER_WINDOW;
    log("lastSeenTime initialized to " + new Date(lastSeenTime).toLocaleString("zh-CN") + " (now - " + (TRIGGER_WINDOW / 1000) + "s)");

    while (true) {
        var messages = fetchLatestMessage();
        if (messages && messages.length > 0) {
            var code = checkTrigger(messages);
            // Update lastSeenTime to the newest message's time
            var newestTime = parseUpdateTime(messages[0].updateTime || "");
            if (newestTime > lastSeenTime) {
                lastSeenTime = newestTime;
            }
            if (code) {
                doStkInput(code);
                log("=== trigger cycle complete, resuming polling ===");
            }
        }
        sleep(POLL_INTERVAL);
    }
}

main();
