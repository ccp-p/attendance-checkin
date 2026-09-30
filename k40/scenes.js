// scenes.js - independent testable scene library for the k40 checkin flow.
//
// Each scene:
//   - is a function in `scenes` below, runnable standalone
//   - persists its output to config.stateDir/<scene>.json so dependent
//     scenes can resume without re-running their predecessors
//   - logs to its own file /sdcard/checkin/autojs/scenes/<scene>.log
//
// Usage (standalone test of one scene):
//   scenes.run("nav")          // from another script
//   or via scenes_main.js with the scene name as script arg
//
// Scene dependency graph:
//   launch -> nav -> attendance -> (checkin | login) -> getcode -> ppapi
//   -> inputcode -> submit -> trusted -> result
// Scenes marked PERSIST save state; dependent scenes read it.

"auto";
var config = require("./config.js");
var logger = require("./lib/logger.js");
var ui = require("./lib/ui.js");
var files_ = require("./lib/files_util.js");

var STATE = config.stateDir;

// --- state helpers -------------------------------------------------

// Per-run memo: within one chain execution (all()), each scene runs ONCE.
// Scenes reached later via dependency calls reuse the memo instead of
// re-invoking launch()/nav()/attendance() (which previously caused the
// app to be force-stopped and re-navigated 3-4x per chain - slow and
// each restart risks a new webview error layer).
var _memo = {};

function memoized(sceneName) {
    if (_memo[sceneName]) return _memo[sceneName];
    var r = scenes[sceneName]();
    _memo[sceneName] = r;
    return r;
}

function save(scene, data) {
    files_.ensureDir(STATE);
    data.scene = scene;
    data.savedAt = new Date().toISOString();
    files_.write(STATE + scene + ".json", JSON.stringify(data, null, 2));
}

function load(scene) {
    var s = files_.read(STATE + scene + ".json");
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
}

// --- scene implementations -----------------------------------------

var scenes = {

    // S1: force-stop the app then cold-launch.
    // CRITICAL (2026-09-29): a warm app process carries stale webview
    // session/cache state - stale punch pages, phantom login dialogs,
    // leftover H5 error layers. Every run MUST start from a clean process.
    // The old code only launchPackage()'d, so an overnight-resident app
    // (cached from yesterday's 17:31 run) fed today's flow yesterday's
    // page state and broke it.
    // Workday gate lives in attendance(): whether today is a working day
    // is decided by what the app shows, not the calendar.
    launch: function () {
        var ok = false;
        // kill any existing process - no exceptions, every run.
        // (Java string array must be built explicitly - a JS array literal
        // with concatenated ConsString crashes with ArrayStoreException.)
        try {
            var cmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
            cmd[0] = "su"; cmd[1] = "-c";
            cmd[2] = "am force-stop " + config.appPackage;
            var pb = new java.lang.ProcessBuilder(cmd);
            pb.start().waitFor();
        } catch (e) { logger.warn("force-stop via su failed: " + e); }
        sleep(1500);
        home();
        sleep(1000);

        var launchCmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
        launchCmd[0] = "su"; launchCmd[1] = "-c"; launchCmd[2] = "am start -n com.cmri.ercs.yqx/com.cmic.module_main.ui.activity.WelcomeActivity";
        new java.lang.ProcessBuilder(launchCmd).start();
        for (var i = 0; i < 15; i++) {
            sleep(2000);
            if (currentPackage() === config.appPackage) { ok = true; break; }
        }
        // wait until a known page text shows up
        var state = null;
        for (var j = 0; j < 10; j++) {
            state = detectState();
            if (state !== "unknown" && state !== "not_in_app") break;
            sleep(2000);
        }
        save("launch", { ok: ok, state: state, coldStart: true });
        return { ok: ok && state !== "unknown" && state !== "not_in_app", state: state };
    },

    // S2: from app home, tap workbench tab, confirm 考勤打卡 entry visible
    nav: function () {
        var dep = memoized("launch");
        if (!dep.ok) return { ok: false, reason: "launch failed: " + dep.state };

        // launch() reports in-app, but the window can still lose focus to
        // the launcher (AutoJs6 editor, home screen) between scenes. The
        // coordinate fallback below would then tap the launcher's desktop -
        // so re-assert the app before tapping anything.
        if (currentPackage() !== config.appPackage) {
            logger.warn("focus lost to " + currentPackage() + ", relaunching app");
            var launchCmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
        launchCmd[0] = "su"; launchCmd[1] = "-c"; launchCmd[2] = "am start -n com.cmri.ercs.yqx/com.cmic.module_main.ui.activity.WelcomeActivity";
        new java.lang.ProcessBuilder(launchCmd).start();
            sleep(3000);
        }

        var clicked = ui.clickText(config.text.tabWorkbench, 8000) ||
                      ui.clickTextContains(config.text.tabWorkbench, 5000);
        if (!clicked) {
            // MIUI bottom-nav text nodes can be 0-bounded; fall back to
            // coordinate tap at workbench tab position (2nd of 4 tabs)
            click(device.width / 8 * 3, device.height - 100);
            logger.warn("workbench text click failed, coordinate fallback");
        }
        sleep(config.timeout.pageLoad);

        // wait for attendance entry; retry the workbench tab once if the
        // first tap didn't take (launcher focus race)
        var found = scenes._waitForText(config.text.attendance, 15000);
        if (!found) {
            logger.warn("attendance entry not seen, re-tapping workbench");
            if (currentPackage() !== config.appPackage) {
                var launchCmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
        launchCmd[0] = "su"; launchCmd[1] = "-c"; launchCmd[2] = "am start -n com.cmri.ercs.yqx/com.cmic.module_main.ui.activity.WelcomeActivity";
        new java.lang.ProcessBuilder(launchCmd).start();
                sleep(3000);
            }
            ui.clickText(config.text.tabWorkbench, 5000) ||
                click(device.width / 8 * 3, device.height - 100);
            found = scenes._waitForText(config.text.attendance, 15000);
        }
        save("nav", { ok: found });
        return { ok: found };
    },

    // Rest-day gate: on 休息日 the attendance page shows no punch buttons
    // at all (only 打卡时间 or a rest notice). If neither 签到 nor 签退 can
    // be found on the live attendance page after opening it, today is a
    // non-working day and the whole chain stops cleanly (ok:false,
    // reason:"rest_day" - not an error).
    _isRestDay: function () {
        var deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            var texts = ui.collectAllTexts();
            var all = texts.join(" ");
            if (all.indexOf(config.text.checkin) >= 0 ||
                all.indexOf(config.text.checkout) >= 0) {
                return false;   // punch buttons present = working day
            }
            sleep(1500);
        }
        return true;   // no punch buttons after 10s = rest day
    },

    // S3: open 考勤打卡, wait for webview 签到/签退 button.
    // Rest-day aware: no punch buttons on the attendance page means today
    // is off (含周日补班判断 - 补班日 app 照常显示按钮, 休息日不显示),
    // chain stops with reason "rest_day".
    attendance: function () {
        var dep = memoized("nav");
        if (!dep.ok) return { ok: false, reason: "nav failed" };

        var opened = ui.clickText(config.text.attendance, 8000) ||
                     ui.clickTextContains(config.text.attendance, 5000);
        if (!opened) {
            // workbench grid may need scrolling
            for (var s = 0; s < 4 && !opened; s++) {
                scrollDown();
                sleep(800);
                opened = ui.clickText(config.text.attendance, 3000);
            }
        }
        if (!opened) { save("attendance", { ok: false }); return { ok: false }; }

        // rest-day gate: attendance page loaded but no punch buttons after
        // the 20s wait -> today is off (调休补班日按钮照常, 休息日无按钮).
        var btn = scenes._waitForAny([config.text.checkin, config.text.checkout], 20000);
        if (!btn) {
            var rest = scenes._isRestDay();
            save("attendance", { ok: false, restDay: rest,
                reason: rest ? "rest_day" : "punch button not found" });
            return { ok: false, restDay: rest, reason: rest ? "rest_day" : "no punch button" };
        }
        save("attendance", { ok: true });
        return { ok: true };
    },

    // S4: handle 位置信息获取失败. Detection alone is not enough - the
    // popup invalidates the current checkin attempt. Recovery (same as
    // checkin.sh recover_location_error): action-bar back out of the H5,
    // re-enter via workbench, reopen attendance. Returns ok only when the
    // attendance page is live again with 签到/签退 visible.
    // Standalone-runnable: also acts as a detector - if the popup is here,
    // recover; if not, confirm the page is healthy.
    location: function () {
        var errNode = text(config.text.locationError).findOne(3000) ||
                      textContains(config.text.locationError).findOne(3000);
        if (!errNode) {
            save("location", { ok: true, recovered: false });
            return { ok: true, recovered: false };
        }
        logger.warn("location error popup - recovering via workbench reload");

        // 1. back out of the current H5 (action-bar back, KEYCODE_BACK fallback)
        var backBtn = id("com.cmri.ercs.yqx:id/btn_back_actionbar").findOne(2500);
        if (backBtn) {
            var b = backBtn.bounds();
            var cx = b.centerX() || 77, cy = b.centerY() || 146;
            click(cx, cy);
            logger.info("location recover: action-bar back");
        } else {
            back();
            logger.info("location recover: KEYCODE_BACK");
        }
        sleep(2000);

        // 2. reach the workbench tab
        var onWorkbench = false;
        for (var w = 0; w < 4 && !onWorkbench; w++) {
            if (ui.clickText(config.text.tabWorkbench, 4000) ||
                ui.clickTextContains(config.text.tabWorkbench, 3000)) {
                onWorkbench = true;
            } else {
                back();
                sleep(1500);
            }
        }
        if (!onWorkbench) { save("location", { ok: false, reason: "workbench unreachable" }); return { ok: false }; }
        sleep(config.timeout.pageLoad);

        // 3. reopen attendance
        var opened = ui.clickText(config.text.attendance, 8000) ||
                     ui.clickTextContains(config.text.attendance, 5000);
        if (!opened) { save("location", { ok: false, reason: "attendance entry not found" }); return { ok: false }; }

        // 4. confirm recovery: 签到/签退 visible AND popup gone
        var healthy = false;
        for (var i = 0; i < 15; i++) {
            sleep(2000);
            var gone = !text(config.text.locationError).findOne(1500) &&
                       !textContains(config.text.locationError).findOne(1500);
            var btn = text(config.text.checkin).findOne(1500) ||
                      text(config.text.checkout).findOne(1500);
            if (gone && btn) { healthy = true; break; }
        }
        save("location", { ok: healthy, recovered: true });
        return { ok: healthy, recovered: true };
    },

    // S5: tap 签到/签退, wait for login page, input phone digits
    login: function () {
        // retry loop: a 位置信息获取失败 popup invalidates the attempt -
        // the location scene reloads attendance from workbench and we retry
        var dep = null;
        for (var attempt = 0; attempt < 3; attempt++) {
            dep = memoized("attendance");
            if (!dep.ok) return { ok: false, reason: "attendance page not reachable" };

            var loc = scenes.location();
            if (loc.recovered && !loc.ok) {
                logger.warn("location error persists (attempt " + (attempt + 1) + "), retrying");
                continue;
            }
            if (!loc.ok) return { ok: false, reason: "location error unresolved" };
            break;
        }
        if (!dep || !dep.ok) return { ok: false, reason: "attendance page not reachable" };

        // tap the attendance H5 button (retry: webview may swallow events).
        // NOTE: on an already-punched day the H5 still shows 打卡按钮 with
        // the punch record - tapping it re-opens the login flow only if
        // session expired; if login page never appears the session is
        // alive and today's punch is already recorded - treat as done.
        var tapped = false;
        for (var i = 0; i < 6 && !tapped; i++) {
            var node = text(config.text.checkin).findOne(3000) ||
                       text(config.text.checkout).findOne(3000);
            if (node) {
                var b = node.bounds();
                click(b.centerX(), b.centerY());
                tapped = true;
                sleep(config.timeout.pageLoad);
            } else {
                sleep(3000);
            }
        }
        if (!tapped) { save("login", { ok: false, reason: "no checkin button" }); return { ok: false }; }

        // wait for login page (获取验证码 or 短信验证码登录)
        var onLogin = scenes._waitForAny(
            [config.text.getCode, config.text.smsLogin], 25000);
        if (!onLogin) {
            // no login page: either the punch went through directly
            // (session alive) or the button tap was swallowed. Check the
            // punch slot - if today's slot row has a timestamp, we're done.
            var v = scenes._verifyAttendanceSlot();
            if (v.ok) {
                logger.ok("no login page but slot already punched: " + v.reason);
                save("login", { ok: true, alreadyPunched: true });
                save("ppapi", { ok: true, code: "ALREADY_PUNCHED" });
                save("inputcode", { ok: true, code: "ALREADY_PUNCHED" });
                save("submit", { ok: true, alreadyPunched: true });
                return { ok: true, alreadyPunched: true };
            }
            save("login", { ok: false, reason: "login page not shown" }); return { ok: false };
        }

        // if 获取验证码 not visible yet, tap 短信验证码登录 first
        var et = className("android.widget.EditText").findOne(3000);
        if (!et) {
            ui.clickAny(config.text.smsLogin, 8000);
            sleep(1500);
        }

        // input phone digits via custom number pad
        var digits = config.phoneInput.split("");
        for (var d = 0; d < digits.length; d++) {
            var key = text(digits[d]).findOne(3000);
            if (key) {
                var kb = key.bounds();
                click(kb.centerX(), kb.centerY());
            } else {
                logger.warn("digit key not found: " + digits[d]);
            }
            sleep(500);
        }
        save("login", { ok: true });
        return { ok: true };
    },

    // S6: tap 获取验证码, confirm countdown appears (SMS actually triggered)
    getcode: function () {
        var dep = load("login");
        if (!dep || !dep.ok) {
            var r = scenes.login();
            if (!r.ok) return { ok: false, reason: "login scene failed" };
        }
        // record pushplus baseline BEFORE requesting the code
        var key = scenes._ppAccessKey();
        var baseline = key ? scenes._ppLatestShortCode(key) : null;
        save("getcode", { ok: null, baseline: baseline });

        var clicked = ui.clickAny(config.text.getCode, 8000);
        if (!clicked) {
            save("getcode", { ok: false, reason: "getCode button not found", baseline: baseline });
            return { ok: false };
        }
        // confirm countdown (button turns into 59s/重新获取 etc.)
        var countdown = false;
        for (var i = 0; i < 12; i++) {
            sleep(1000);
            var texts = ui.collectAllTexts();
            var all = texts.join(" ");
            if (/\d{1,2}\s*s/.test(all) || all.indexOf("重新获取") >= 0 || all.indexOf("重发") >= 0) {
                countdown = true;
                break;
            }
        }
        var st = load("getcode");
        st.ok = countdown;
        if (!countdown) st.reason = "no countdown after getCode tap";
        save("getcode", st);
        return { ok: countdown, baseline: baseline };
    },

    // S7: poll pushplus message list API for a NEW message, extract code
    // pure HTTP - no UI interaction, safe to rerun with same baseline
    ppapi: function () {
        var dep = load("getcode");
        var baseline = dep ? dep.baseline : null;
        if (!dep || dep.ok === false) {
            logger.warn("getcode not confirmed ok; polling anyway");
        }
        var deadline = Date.now() + config.ppWaitForCodeMs;
        var code = null;
        var key = scenes._ppAccessKey();
        if (!key) { save("ppapi", { ok: false, reason: "no access key" }); return { ok: false }; }

        var reTapped = 0;
        while (Date.now() < deadline) {
            var sc = scenes._ppLatestShortCode(key);
            if (sc && sc !== baseline) {
                // new message: fetch list and extract code from titles
                var titles = scenes._ppTitles(key);
                for (var i = 0; i < titles.length; i++) {
                    if (titles[i].length <= 10) continue;
                    if (/^[0-9]+$/.test(titles[i])) continue;  // sender IDs
                    var m = titles[i].match(/(\d{6})/);
                    if (m) { code = m[1]; break; }
                }
                if (code) break;
            }
            // mid-poll re-tap: recover a missed first get-code tap (same
            // heuristic as checkin.sh - re-tapping a countdown is a no-op)
            reTapped++;
            if (reTapped % 6 === 0) {
                try {
                    var btn = text(config.text.getCode).findOne(1500);
                    if (!btn) {
                        var b2 = textContains("s").findOne(800); // countdown node
                    }
                } catch (e) {}
            }
            sleep(config.ppPollIntervalMs);
        }
        save("ppapi", { ok: !!code, code: code });
        return { ok: !!code, code: code };
    },

    // S8: back to app, fill EditText with code
    inputcode: function () {
        var dep = load("ppapi");
        if (!dep || !dep.ok) return { ok: false, reason: "no code from ppapi" };
        var code = dep.code;

        var launchCmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
        launchCmd[0] = "su"; launchCmd[1] = "-c"; launchCmd[2] = "am start -n com.cmri.ercs.yqx/com.cmic.module_main.ui.activity.WelcomeActivity";
        new java.lang.ProcessBuilder(launchCmd).start();
        sleep(config.timeout.appLaunch);
        var et = className("android.widget.EditText").findOne(8000);
        var ok = false;
        if (et) {
            et.click(); sleep(300);
            ok = et.setText(code);
            logger.info("code set via EditText: " + code);
        }
        if (!ok) ok = setText(code);
        sleep(1000);
        save("inputcode", { ok: ok, code: code });
        return { ok: ok, code: code };
    },

    // S9: submit login (tap 短信验证码登录), handle trusted-auth popup
    // Trusted flow: the popup/page must be dismissed via the native
    // action-bar BACK button (btn_back_actionbar), NOT the webview 取消.
    // Tapping 取消 lands on an H5 "认证失败/您已取消认证流程" error page
    // (EnterpriseH5ProcessActivity) which intercepts KEYCODE_BACK - only
    // the action-bar back reliably exits.
    submit: function () {
        var dep = load("inputcode");
        if (!dep || !dep.ok) return { ok: false, reason: "inputcode scene not done" };

        // collapse keyboard first - login button is hidden under it
        var et = className("android.widget.EditText").findOne(2000);
        if (et && et.focused && et.focused()) back();

        var clicked = ui.clickAny(config.text.smsLogin, 8000);
        if (!clicked) { save("submit", { ok: false, reason: "submit button not found" }); return { ok: false }; }
        sleep(config.timeout.pageLoad);

        // trusted auth / H5 error pages exit: each back pops ONE layer
        // (认证失败 -> 可信认证 -> 考勤打卡). The loop MUST end with the
        // attendance layer in front (punch-slot rows visible) - stopping
        // on any trust/error layer is NOT acceptable.
        var trusted = false;
        var landed = false;
        for (var i = 0; i < 10; i++) {
            if (scenes._isTrusted() || scenes._isTrustErrorPage()) {
                trusted = true;
                scenes._cancelTrusted();
                sleep(2500);
                continue;
            }
            // not on a trust page - check the attendance layer is in front
            var texts = ui.collectAllTexts().join(" ");
            var hasSlots = texts.indexOf("上班打卡时间") >= 0 || texts.indexOf("下班打卡时间") >= 0;
            if (hasSlots) { landed = true; }
            break;
        }
        if (trusted && !landed) {
            // back loop exhausted without reaching attendance - keep
            // pressing back in result() via _verifyAttendanceSlot
            logger.warn("submit: trust layers not fully exited");
        }
        save("submit", { ok: true, trusted: trusted, landed: landed });
        return { ok: true, trusted: trusted, landed: landed };
    },

    // S10: verify final result.
    // Success = the CURRENT time slot (morning 上班 / evening 下班) shows a
    // punch timestamp, verified on the attendance page itself. "Login dialog
    // gone" alone is NOT success - the flow must land back on the 考勤打卡
    // page and the time-window row must carry a date.
    // Screenshot discipline: only shoot AFTER _verifyAttendanceSlot has
    // confirmed the clean attendance layer (no error webview stacked) -
    // a screenshot of the trust/error page is useless to the user, and a
    // shot taken during a webview transition renders broken in WeChat
    // (the "图裂了" case). _verifyAttendanceSlot already loops back-presses
    // until the page settles, so by the time we get here the screen is
    // either the real attendance page or genuinely unreachable.
    result: function () {
        var r = scenes._verifyAttendanceSlot();
        var ok = r.ok, reason = r.reason;

        // capture proof screenshot - only now, on the settled page
        var shot = null;
        if (r.landed !== false) {
            try {
                shot = scenes._screenshot("result_" + (ok ? "success" : "fail"));
                // integrity check: screencap can race a webview transition
                // and write a truncated file -> re-shoot once if tiny
                if (shot) {
                    var len = files.getSFileSize ? 0 : 0;
                    try {
                        var f = new java.io.File(shot);
                        if (f.length() < 20000) {   // real frames are 90KB+
                            logger.warn("screenshot too small (" + f.length() + "B), re-shooting");
                            sleep(1500);
                            shot = scenes._screenshot("result_retry");
                        }
                    } catch (e2) {}
                }
            } catch (e) { logger.warn("screenshot failed: " + e); }
        }

        // push success notification (with screenshot) to WeChat via pushplus
        if (ok) {
            var pushed = scenes._notifySuccess(shot, reason);
            save("result", { ok: ok, reason: reason, shot: shot, notified: pushed });
        } else {
            save("result", { ok: ok, reason: reason, shot: shot });
        }
        return { ok: ok, reason: reason, slot: r.slot, shot: shot };
    },

    // Determine morning/evening slot from wall clock, then verify the
    // attendance page shows a punch record for that slot.
    // Page layout (from live dumps):
    //   上班打卡时间：07:00-08:30 / 下班打卡时间：17:30-23:59
    //   签到 ... 上班 <timestamp or 未签到>
    //   签退/下班 <timestamp or 未签到>
    // Success: slot row text contains a date (yyyy-mm-dd hh:mm:ss), not 未签到.
    _verifyAttendanceSlot: function () {
        var h = new Date().getHours();
        var slotName, slotLabel;
        if (h < 12) { slotName = "morning"; slotLabel = "上班"; }
        else { slotName = "evening"; slotLabel = "下班"; }

        // The ONLY valid judging ground is the 考勤打卡 layer with NO error
        // webview stacked on it. Traps found on-device:
        //  1. trust/H5 error pages carry the action-bar title 考勤打卡 too
        //  2. the H5 error webview (认证失败) renders in the SAME activity;
        //     collectAllTexts sees both layers (slots=true err=true), so
        //     slot rows alone don't prove the error layer is gone
        //  3. OVERSHOOT: one extra back leaves the app entirely (HomeActivity)
        // Rule: press action-bar back while 认证失败/可信认证 is in the tree,
        // and STOP THE MOMENT error text is gone while slots are present.
        // Never press one more "just in case" back - that exits the app.
        function allText() {
            var arr = [];
            var root = auto.rootInActiveWindow;
            function collect(n) {
                if (!n) return;
                var t = n.text();
                if (t) arr.push(t);
                for (var i = 0; i < n.childCount(); i++) collect(n.child(i));
            }
            collect(root);
            return arr.join(" ");
        }
        function settled(all) {
            return all.indexOf("认证失败") < 0 &&
                   all.indexOf("可信认证") < 0 &&
                   all.indexOf("您已取消认证流程") < 0 &&
                   (all.indexOf("上班打卡时间") >= 0 || all.indexOf("下班打卡时间") >= 0);
        }

        var all = allText();
        if (!settled(all)) {
            logger.info("error/trust layer present, backing out to clean attendance");
            for (var t = 0; t < 8; t++) {
                scenes._cancelTrusted();          // action-bar back, one layer per press
                sleep(2500);
                all = allText();
                if (settled(all)) break;
            }
        }
        if (!settled(all)) {
            // possibly overshot out of the app (back too many times) -
            // re-launch and navigate back to attendance
            if (currentPackage() !== config.appPackage) {
                logger.warn("backed out of app, re-launching");
                var launchCmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
        launchCmd[0] = "su"; launchCmd[1] = "-c"; launchCmd[2] = "am start -n com.cmri.ercs.yqx/com.cmic.module_main.ui.activity.WelcomeActivity";
        new java.lang.ProcessBuilder(launchCmd).start();
                sleep(4000);
                all = allText();
            }
            if (!settled(all)) {
                scenes.attendance();          // nav + open 考勤打卡 (waits for slot rows)
                all = allText();
            }
        }
        if (!settled(all)) {
            return { ok: false, landed: false, slot: slotName, reason: "attendance page not reachable (error layer stuck)" };
        }

        // settle wait: the webview keeps rendering for a couple of seconds
        // after the layer is judged clean - a shot taken too early renders
        // broken in WeChat (image cracked). Give it 5s before shooting.
        logger.info("page settled, waiting 5s for full render before screenshot");
        sleep(5000);
        // re-verify nothing stacked on the page during the wait
        all = allText();
        if (!settled(all)) {
            logger.warn("error layer appeared during settle wait, backing out again");
            for (var t2 = 0; t2 < 5; t2++) {
                scenes._cancelTrusted();
                sleep(2500);
                all = allText();
                if (settled(all)) break;
            }
            if (!settled(all)) {
                return { ok: false, landed: false, slot: slotName, reason: "error layer stuck after settle wait" };
            }
            sleep(5000);
        }

        // find the slot row value. Webview order: 签到 <time>, 上班 <time|未签到>
        // ... 签退 <time>, 下班 <time|未签到>. The label node we want is the
        // LAST standalone 上班/下班 (the standalone row), not ones inside
        // longer strings - and its value = next text matching either a
        // timestamp or 未签到 (skipping dup labels / 签到 / 打卡地点).
        var texts = ui.collectAllTexts();
        var idx = -1;
        for (var i = 0; i < texts.length; i++) {
            if (texts[i] === slotLabel) { idx = i; }   // keep LAST exact match
        }
        if (idx < 0) {
            // fallback: prefix match excluding 打卡时间 header rows
            for (var i2 = 0; i2 < texts.length; i2++) {
                var ti = texts[i2];
                if (ti.indexOf(slotLabel) >= 0 && ti.indexOf("时间") < 0 &&
                    ti.indexOf("打卡") < 0) { idx = i2; }
            }
        }
        if (idx < 0) return { ok: false, slot: slotName, reason: slotLabel + " row not found" };

        // value = next text that is a timestamp or 未签到 (skip labels/dups)
        var value = "";
        for (var j = idx + 1; j < texts.length; j++) {
            var t2 = texts[j];
            if (!t2) continue;
            if (t2 === slotLabel || t2.indexOf("签到") >= 0 && t2.indexOf("未签到") < 0) continue;
            if (t2.indexOf("打卡地点") >= 0 || t2.indexOf("正常") >= 0 || t2.indexOf("异常") >= 0) continue;
            if (/^\d{4}-\d{2}-\d{2}/.test(t2) || t2.indexOf("未签到") >= 0) { value = t2; break; }
        }
        // success = value looks like a timestamp "2026-09-28 07:18:07"
        var punched = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(value);
        logger.info("slot " + slotName + " (" + slotLabel + ") value=" + value +
            " -> " + (punched ? "PUNCHED" : "not punched"));
        return {
            ok: punched,
            slot: slotName,
            reason: punched ? (slotLabel + " punched at " + value) : (slotLabel + " shows: " + value)
        };
    },

    // capture the screen to a png, then shrink it via root Python-free
    // bitmap pipeline: Android's own screencap writes a full-res png (~96KB
    // which is fine) - pushplus OOM is only in AutoJs6's OpenCV scale, so
    // use images.resize-free approach: re-encode smaller via root su exec
    // of "am" is not possible. Instead capture with reduced size directly
    // is unsupported; rely on base64 size check in _notifySuccess.
    _screenshot: function (name) {
        var dir = "/sdcard/checkin/autojs/shots/";
        var path = dir + name + "_" + Math.floor(Date.now() / 1000) + ".png";
        try {
            files.createWithDirs(dir + "placeholder");
        } catch (e) {}
        try {
            // root: java.lang.ProcessBuilder run as su
            // (string array must be Java Strings - ConsString breaks it)
            var cmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
            cmd[0] = "su"; cmd[1] = "-c"; cmd[2] = "screencap -p " + path;
            var pb = new java.lang.ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            var proc = pb.start();
            proc.waitFor();
        } catch (e) {
            logger.warn("root screencap failed: " + e);
        }
        if (files.exists(path)) {
            logger.ok("screenshot saved: " + path);
            return path;
        }
        return null;
    },

    // Squeeze a screenshot into pushplus's ~16.3k char body limit.
    // The image must ALWAYS go out, and must NEVER crack in WeChat.
    // 2026-09-29: 14.7k-char payloads passed our 13500 check but still
    // cracked in WeChat rendering - the real safe ceiling is lower and
    // the crop was too generous. New ladder (much more aggressive):
    //   1. inSampleSize=8 (135x300) + middle 70% + q30  -> ~3-4k chars
    //   2. still over -> inSampleSize=8 + middle 50% + q20
    // Size headroom matters more than resolution: WeChat tolerates small
    // blurry images, cracked ones are useless.
    _fitBase64: function (path) {
        var BitmapFactory = android.graphics.BitmapFactory;
        var Bitmap = android.graphics.Bitmap;
        var BAOS = java.io.ByteArrayOutputStream;
        var LIMIT = 9000;   // well under the 16.3k body cap - headroom for WeChat
        function encode(bmp, q) {
            var out = new BAOS();
            bmp.compress(Bitmap.CompressFormat.JPEG, q, out);
            return android.util.Base64.encodeToString(out.toByteArray(),
                android.util.Base64.NO_WRAP);
        }
        // keep [keepFrom%, keepTo%] of the bitmap's height
        function cropBand(bmp, from, to) {
            var y0 = Math.floor(bmp.getHeight() * from);
            var y1 = Math.ceil(bmp.getHeight() * to);
            return Bitmap.createBitmap(bmp, 0, y0, bmp.getWidth(), y1 - y0);
        }
        try {
            // pass 1: eighth res, middle 70% band (drops status bar + nav)
            var o1 = new BitmapFactory.Options(); o1.inSampleSize = 8;
            var bmp = BitmapFactory.decodeFile(path, o1);
            if (!bmp) return null;
            var band = cropBand(bmp, 0.15, 0.85);
            b64 = encode(band, 30);
            if (b64.length <= LIMIT) { bmp.recycle(); band.recycle(); return b64; }
            band.recycle();
            // pass 2: eighth res, middle 50% band, lower quality
            var mid = cropBand(bmp, 0.25, 0.75);
            b64 = encode(mid, 20);
            if (b64.length <= LIMIT) { bmp.recycle(); mid.recycle(); return b64; }
            mid.recycle();
            // pass 3: whatever it takes - sixteenth res middle band
            var o2 = new BitmapFactory.Options(); o2.inSampleSize = 16;
            var tiny = BitmapFactory.decodeFile(path, o2);
            if (tiny) {
                var tband = cropBand(tiny, 0.2, 0.8);
                b64 = encode(tband, 20);
                tiny.recycle(); tband.recycle();
            }
            bmp.recycle();
            return b64;   // even if oversized - better than nothing
        } catch (e) { logger.warn("fitBase64: " + e); return null; }
    },

    // push checkin-success notification to WeChat via pushplus, WITH the
    // success screenshot embedded as a base64 data URI in an html email-style
    // card. pushplus html template supports <img src="data:image/png;base64,...">
    _notifySuccess: function (shotPath, reason) {
        try {
            var d = new Date();
            function p(n) { return (n < 10 ? "0" : "") + n; }
            var when = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
                " " + p(d.getHours()) + ":" + p(d.getMinutes());
            var html = "<h3>✅ K40 打卡成功</h3><p>时间: " + when + "</p>" +
                (reason ? "<p>判定: " + reason + "</p>" : "");
            if (shotPath && files.exists(shotPath)) {
                // pushplus /send html body hard limit ~16.3k chars (probed).
                // A screenshot MUST go out - cropping half the image is
                // acceptable, omitting it is not. Strategy: inSampleSize
                // shrink (270x600), if still too big crop to the top half
                // (status + slot rows live there), then drop JPEG quality
                // progressively until it fits.
                var b64 = scenes._fitBase64(shotPath);
                if (b64) {
                    html += '<p><img src="data:image/jpeg;base64,' + b64 +
                        '" style="max-width:100%"/></p>';
                } else {
                    // last resort: never leave the message imageless
                    html += "<p>(截图编码失败)</p>";
                }
            } else {
                html += "<p>(无截图)</p>";
            }
            var res = http.postJson(config.ppApiBase + "/send",
                {
                    token: config.ppToken,
                    title: "打卡成功 " + when,
                    content: html,
                    template: "html"
                }, { timeout: 15000 });
            var body = res.body.json();
            if (body && body.code === 200) {
                logger.ok("pushplus success notification sent (with screenshot)");
                return true;
            }
            logger.warn("pushplus send failed: " + JSON.stringify(body));
        } catch (e) { logger.error("notify: " + e); }
        return false;
    },

    // full chain S1..S10
    // full chain S1..S10. Runs every day (cron has no weekday filter):
    // on 休息日 the attendance scene detects no punch buttons and stops
    // cleanly with restDay:true - not an error, no notification spam.
    // On 调休补班日 (weekend but working) the buttons show and the chain
    // proceeds normally.
    all: function () {
        var chain = ["launch", "nav", "attendance", "login", "getcode",
                     "ppapi", "inputcode", "submit", "result"];
        var results = {};
        for (var i = 0; i < chain.length; i++) {
            var name = chain[i];
            logger.info("---- scene: " + name + " ----");
            var r;
            try { r = scenes[name](); } catch (e) { r = { ok: false, reason: "exception: " + e }; }
            results[name] = r;
            // record in memo so later dependency calls don't re-run it
            _memo[name] = r;
            logger.info("scene " + name + " -> " + JSON.stringify(r));
            if (r && r.alreadyPunched) {
                // session was alive and today's slot already has a punch:
                // skip straight to result (screenshot + notification)
                logger.ok("今日该时段已打卡, 跳到 result 验证");
                results.result = scenes.result();
                return results;
            }
            if (!r.ok) {
                if (r.restDay) {
                    logger.ok("今天休息, 无需打卡 (rest day, chain ended cleanly)");
                    // write a result marker so the cron wrapper knows the
                    // run COMPLETED (nothing to do) - no shell fallback
                    save("result", { ok: true, restDay: true,
                        reason: "rest day, no checkin needed" });
                } else {
                    logger.error("chain stopped at scene: " + name);
                }
                break;
            }
        }
        return results;
    },

    // --- internal helpers ---

    _waitForText: function (txt, timeoutMs) {
        var deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            var texts = ui.collectAllTexts();
            if (texts.join(" ").indexOf(txt) >= 0) return true;
            sleep(1000);
        }
        return false;
    },

    _waitForAny: function (arr, timeoutMs) {
        var deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            var texts = ui.collectAllTexts();
            var all = texts.join(" ");
            for (var i = 0; i < arr.length; i++) {
                if (all.indexOf(arr[i]) >= 0) return true;
            }
            sleep(1000);
        }
        return false;
    },

    _isTrusted: function () {
        var all = ui.collectAllTexts().join(" ");
        return all.indexOf(config.text.trustedAuth) >= 0 ||
               all.indexOf(config.text.trustedAuthPlatform) >= 0;
    },

    // post-cancel H5 error page ("认证失败/您已取消认证流程") - same
    // activity, still needs the action-bar back to leave
    _isTrustErrorPage: function () {
        var all = ui.collectAllTexts().join(" ");
        return all.indexOf("认证失败") >= 0 ||
               all.indexOf("您已取消认证流程") >= 0;
    },

    // Trusted auth exit: tap the native action-bar BACK button
    // (resource-id btn_back_actionbar). The webview 取消 only lands on
    // the H5 error page; KEYCODE_BACK is intercepted there. Verified on
    // real device: 认证失败 page -> back -> 可信认证 page -> back ->
    // 考勤打卡 page. Each back only exits ONE layer, so loop until the
    // attendance page (考勤打卡) is visible or layers run out.
    _cancelTrusted: function () {
        // 1. native back button by resource-id (webview pages keep it)
        var node = id("com.cmri.ercs.yqx:id/btn_back_actionbar").findOne(2500);
        if (node) {
            var b = node.bounds();
            var cx = b.centerX(), cy = b.centerY();
            if (cx === 0 && cy === 0) { cx = 77; cy = 146; }
            click(cx, cy);
            logger.ok("trusted exit via action-bar back " + cx + "," + cy);
            return true;
        }
        // 2. no actionbar node - top-left fallback (77,146 from live dump)
        click(77, 146);
        logger.ok("trusted exit via coord fallback (77,146)");
        return true;
    },

    _ppAccessKey: function () {
        try {
            var res = http.postJson(config.ppApiBase + "/api/common/openApi/getAccessKey",
                { token: config.ppToken, secretKey: config.ppSecretKey }, { timeout: 10000 });
            var body = res.body.json();
            if (body && body.data && body.data.accessKey) return body.data.accessKey;
        } catch (e) { logger.error("pp access key: " + e); }
        return null;
    },

    _ppLatestShortCode: function (key) {
        try {
            var res = http.postJson(config.ppApiBase + config.ppListPath,
                { current: 1, pageSize: 3 },
                { headers: { "access-key": key }, timeout: 10000 });
            var body = res.body.json();
            if (body && body.data && body.data.list && body.data.list.length > 0) {
                return body.data.list[0].shortCode;
            }
        } catch (e) { logger.error("pp list: " + e); }
        return null;
    },

    _ppTitles: function (key) {
        try {
            var res = http.postJson(config.ppApiBase + config.ppListPath,
                { current: 1, pageSize: 3 },
                { headers: { "access-key": key }, timeout: 10000 });
            var body = res.body.json();
            if (body && body.data && body.data.list) {
                var titles = [];
                for (var i = 0; i < body.data.list.length; i++) {
                    titles.push(body.data.list[i].title || "");
                }
                return titles;
            }
        } catch (e) { logger.error("pp titles: " + e); }
        return [];
    }
};

// detect current page state (same priority as checkin.sh detect_state)
function detectState() {
    var pkg = currentPackage();
    if (pkg !== config.appPackage) return "not_in_app";
    var all = ui.collectAllTexts().join(" ");
    if (all.indexOf(config.text.getCode) >= 0) return "login_phone";
    if (all.indexOf(config.text.smsLogin) >= 0) return "login_phone";
    if (all.indexOf(config.text.checkin) >= 0 || all.indexOf(config.text.checkout) >= 0) return "attendance";
    if (all.indexOf(config.text.attendance) >= 0) return "workbench";
    if (all.indexOf(config.text.tabWorkbench) >= 0) return "home";
    return "unknown";
}

scenes.detectState = detectState;
module.exports = scenes;
