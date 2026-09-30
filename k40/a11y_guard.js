// a11y_guard.js - accessibility health guard for the checkin scene flow.
//
// Problem: MIUI kills/rebinds accessibility services; when the service is
// gone at trigger time, every scene fails with "未找到文字" and the
// checkin silently breaks.
//
// 2026-09-30 upgrade: Settings.Secure.putString alone is unreliable on
// MIUI (framework ignores the write when the AccessibilityManagerService
// is in a stale state). Now uses root shell settings put to force a
// REAL off/on cycle at the system level, which always triggers a rebind.
// If the first root toggle doesn't work, escalates to killing AutoJs6's
// a11y binding by toggling the service twice with a longer delay.

"auto";
var logger = require("./lib/logger.js");

var A11Y_SVC = "org.autojs.autojs6/org.autojs.autojs.core.accessibility.AccessibilityServiceUsher";
var RESOLVER = context.getContentResolver();
var SECURE = android.provider.Settings.Secure;

function execRoot(cmd) {
    try {
        var cmdArr = java.lang.reflect.Array.newInstance(java.lang.String, 3);
        cmdArr[0] = "su"; cmdArr[1] = "-c"; cmdArr[2] = cmd;
        var pb = new java.lang.ProcessBuilder(cmdArr);
        pb.redirectErrorStream(true);
        var p = pb.start();
        p.waitFor();
        return true;
    } catch (e) {
        logger.warn("[a11y_guard] execRoot failed: " + e);
        return false;
    }
}

function enabledServices() {
    var v = SECURE.getString(RESOLVER, SECURE.ENABLED_ACCESSIBILITY_SERVICES);
    return v ? v.split(":").filter(function (s) { return !!s; }) : [];
}

function putEnabledServices(list) {
    SECURE.putString(RESOLVER, SECURE.ENABLED_ACCESSIBILITY_SERVICES, list.join(":"));
    SECURE.putInt(RESOLVER, SECURE.ACCESSIBILITY_ENABLED, 1);
}

function serviceBound() {
    try {
        if (auto.rootInActiveWindow !== null) return true;
    } catch (e) {}
    try {
        var any = className("android.widget.TextView").find();
        if (any && any.size() > 0) return true;
    } catch (e) {}
    return false;
}

// Force toggle via root shell - writes the setting at the system level,
// which forces AccessibilityManagerService to unbind + rebind.
function rootToggle(on) {
    if (on) {
        execRoot("settings put secure enabled_accessibility_services " + A11Y_SVC);
        execRoot("settings put secure accessibility_enabled 1");
    } else {
        execRoot("settings put secure enabled_accessibility_services ''");
        execRoot("settings put secure accessibility_enabled 0");
    }
}

// Full self-heal: root off -> wait -> root on -> wait for rebind.
// Escalates: first attempt 3s delay, second attempt 6s delay.
function rootHeal(maxWaitMs) {
    maxWaitMs = maxWaitMs || 20000;
    logger.warn("[a11y_guard] root self-heal: toggling service");

    for (var attempt = 0; attempt < 2; attempt++) {
        var delay = attempt === 0 ? 3000 : 6000;
        rootToggle(false);
        sleep(delay);
        rootToggle(true);
        sleep(delay);

        var deadline = Date.now() + Math.min(maxWaitMs, 10000);
        while (Date.now() < deadline) {
            sleep(2000);
            if (serviceBound()) {
                logger.ok("[a11y_guard] root heal attempt " + (attempt + 1) + " succeeded");
                return true;
            }
        }
        logger.warn("[a11y_guard] root heal attempt " + (attempt + 1) + " failed, retrying");
    }
    return false;
}

// Ensure accessibility is usable; returns true when serviceBound() works.
function ensure(maxWaitMs) {
    maxWaitMs = maxWaitMs || 20000;

    if (serviceBound()) return true;

    // try root heal first (strongest)
    if (rootHeal(maxWaitMs)) return true;

    // fallback: Settings.Secure toggle (in case root exec failed)
    logger.warn("[a11y_guard] falling back to Settings.Secure toggle");
    var list = enabledServices();
    if (list.indexOf(A11Y_SVC) < 0) list.push(A11Y_SVC);
    var others = list.filter(function (s) { return s !== A11Y_SVC; });
    putEnabledServices(others);
    sleep(1500);
    putEnabledServices(list.concat([A11Y_SVC]));

    var deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        sleep(2000);
        if (serviceBound()) {
            logger.ok("[a11y_guard] service rebound via Settings.Secure");
            return true;
        }
    }
    logger.error("[a11y_guard] service did NOT recover within " + maxWaitMs + "ms");
    return false;
}

function watchLoop(intervalMs) {
    logger.info("[a11y_guard] watch mode started (interval " + intervalMs + "ms)");
    while (true) {
        if (!serviceBound()) {
            logger.warn("[a11y_guard] watch: service lost, self-healing");
            ensure(20000);
        }
        sleep(intervalMs);
    }
}

module.exports = {
    ensure: ensure,
    serviceBound: serviceBound,
    rootHeal: rootHeal,
    watch: function () { watchLoop(30000); }
};
