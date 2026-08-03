#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Attendance checkin flow (uiautomator2 / PC-driven over USB adb).

Implements the full checkin + SMS-login flow documented in agent.md,
with a NEW step that detects the randomly-appearing "可信认证"
(trusted authentication) webview popup after submitting the SMS login
and dismisses it by clicking the "取消" (cancel) button.
"""

import uiautomator2 as u2
import time
import re
import os
import subprocess
import xml.etree.ElementTree as ET

# ------------------------------------------------------------------
# ensure adb is on PATH (u2 needs it)
# ------------------------------------------------------------------
_ADB_DIR = r"D:\codeTool\codeEnv\flutterEnv\AndroidSdk\platform-tools"
if _ADB_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _ADB_DIR + os.pathsep + os.environ.get("PATH", "")

# ------------------------------------------------------------------
# config (mirrors config.js, corrected from agent.md)
# ------------------------------------------------------------------
APP_PACKAGE = "com.cmri.ercs.yqx"
WECHAT_PACKAGE = "com.tencent.mm"
PHONE_INPUT = "2449"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCREENSHOT_DIR = os.path.join(SCRIPT_DIR, "screenshots")
LOG_FILE = os.path.join(SCRIPT_DIR, "checkin.log")
PHONE_LOG_FILE = "/sdcard/attendance_checkin/checkin.log"

T = {
    "tabWorkbench": "工作台",
    "attendance": "考勤打卡",
    "checkin": "签到",
    "checkout": "签退",
    "smsLogin": "短信验证码登录",
    "getCode": "获取验证码",
    "codeExpired": "短信验证码过期或不存在",
    "pushplus": "pushplus",
    "viewDetail": "查看详情",
    "trustedAuth": "可信认证",
    "cancel": "取消",
    "locationError": "位置信息获取失败",
    "confirm": "确认",
}

TO = {
    "findElement": 10,
    "waitForCode": 90,
    "pageLoad": 3,
    "appLaunch": 5,
    "pushplusDelay": 6,
}


# ------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------
_log_fh = None


def _init_log():
    global _log_fh
    _log_fh = open(LOG_FILE, "a", encoding="utf-8")


def log(msg, level="INFO"):
    line = f"[{time.strftime('%H:%M:%S')}] [{level}] {msg}"
    print(line, flush=True)
    if _log_fh:
        _log_fh.write(line + "\n")
        _log_fh.flush()


def _push_log_to_phone(d):
    try:
        d.shell("mkdir -p /sdcard/attendance_checkin")
        import subprocess
        subprocess.run(["adb", "push", LOG_FILE, PHONE_LOG_FILE],
                       capture_output=True, timeout=10)
        log("  log pushed to phone")
    except Exception as e:
        log(f"  push log to phone failed: {e}", "WARN")


def _close_log():
    if _log_fh:
        _log_fh.close()


def shot(d, name):
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    p = os.path.join(SCREENSHOT_DIR, f"{name}.png")
    d.screenshot(p)
    log(f"  screenshot -> {p}")
    return p


def dump_texts(d):
    """Return (list_of_texts, raw_xml) from the accessibility tree.

    Uses u2 dump_hierarchy() as primary. For webview elements that u2
    misses (popups, buttons), callers can use native_dump_texts() which
    uses adb shell uiautomator dump directly.
    """
    xml = d.dump_hierarchy()
    root = ET.fromstring(xml)
    texts = []
    for node in root.iter():
        t = node.get("text", "")
        c = node.get("content-desc", "")
        if t and t.strip():
            texts.append(t.strip())
        if c and c.strip():
            texts.append(c.strip())
    return texts, xml
def native_dump_texts(d, min_nodes=15, retries=2):
    """Dump accessibility tree via adb shell uiautomator dump.

    Uses subprocess to call adb directly ? u2 d.shell() kills the
    uiautomator process (exit_code 137, OOM) before it finishes.
    Returns (list_of_texts, raw_xml).
    """
    tmp_file = f"/sdcard/ui_native_{int(time.time() * 1000)}.xml"
    for attempt in range(retries):
        try:
            # Use subprocess directly (d.shell kills uiautomator)
            r = subprocess.run(
                ["adb", "shell", "uiautomator", "dump", tmp_file],
                capture_output=True, text=True, timeout=30,
            )
            if r.returncode != 0 or "ERROR" in r.stdout:
                log(f"  native_dump attempt {attempt+1}: dump failed", "WARN")
                time.sleep(0.5)
                continue
            r2 = subprocess.run(
                ["adb", "shell", "cat", tmp_file],
                capture_output=True, timeout=10,
            )
            raw = r2.stdout.decode("utf-8", errors="replace")
            if not raw or not raw.strip():
                log(f"  native_dump attempt {attempt+1}: empty file", "WARN")
                time.sleep(0.5)
                continue
            root = ET.fromstring(raw)
            node_count = sum(1 for _ in root.iter())
            texts = []
            for node in root.iter():
                t = node.get("text", "")
                c = node.get("content-desc", "")
                if t and t.strip():
                    texts.append(t.strip())
                if c and c.strip():
                    texts.append(c.strip())
            if node_count >= min_nodes or attempt == retries - 1:
                if node_count < min_nodes:
                    log(f"  native_dump returned {node_count} nodes", "WARN")
                subprocess.run(["adb", "shell", "rm", "-f", tmp_file],
                               capture_output=True, timeout=5)
                return texts, raw
            time.sleep(0.5)
        except Exception as e:
            log(f"  native_dump_texts attempt {attempt+1} failed: {e}", "WARN")
            time.sleep(0.5)
    try:
        subprocess.run(["adb", "shell", "rm", "-f", tmp_file],
                       capture_output=True, timeout=5)
    except Exception:
        pass
    return [], ""
def dismiss_location_popup(d):
    """Detect and dismiss the ???????? popup that sometimes
    appears over the attendance webview.  u2 dump misses it, so
    we use the native uiautomator dump to check.
    """
    texts, xml = native_dump_texts(d)
    all_text = " ".join(texts)
    if T["locationError"] not in all_text and T["confirm"] not in all_text:
        return False  # no popup

    loc_err = T["locationError"]; conf = T["confirm"]; log(f"  {loc_err} popup detected, clicking {conf}", "WARN")
    # Find confirm button bounds from native XML and click center
    root = ET.fromstring(xml)
    for node in root.iter():
        t = node.get("text", "")
        if t and T["confirm"] in t:
            bounds = node.get("bounds", "")
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
            if m:
                cx = (int(m.group(1)) + int(m.group(3))) // 2
                cy = (int(m.group(2)) + int(m.group(4))) // 2
                d.click(cx, cy)
                log(f"  click {conf} at ({cx},{cy})")
                time.sleep(2)
                return True
    # fallback: click by coordinate from native dump
    if click_xml_bounds(d, xml, T["confirm"]):
        log(f"  click {conf} via XML bounds")
        time.sleep(2)
        return True
    log(f"  {conf} button not found in popup XML", "ERROR")
    return False


def print_screen(d, label="screen"):
    texts, _ = dump_texts(d)
    pkg = d.app_current().get("package", "?")
    log(f"  [{label}] pkg={pkg}")
    log(f"  [{label}] texts({len(texts)}): {texts[:25]}")


def detect_state(d):
    """Inspect current screen and return (state, texts) so main() can
    resume from the right step instead of restarting from scratch.

    States:
      not_in_app      - wrong package, need to launch
      home            - app home with bottom tabs, not on workbench
      workbench       - workbench tab selected, attendance visible
      attendance      - attendance page with checkin button
      login_phone     - login page (need phone input + sms login + get code)
      code_countdown  - login page, countdown active (code already sent)
      unknown         - cannot determine
    """
    pkg = d.app_current().get("package", "")
    texts, _ = dump_texts(d)
    all_text = " ".join(texts)

    if pkg != APP_PACKAGE:
        return "not_in_app", texts

    # login page: 获取验证码 button visible (need phone + request code)
    if T["getCode"] in all_text:
        return "login_phone", texts

    # login page: countdown active (code already sent, button changed to countdown)
    if T["smsLogin"] in all_text and (re.search(r"\d{1,2}s", all_text) or "重新获取" in all_text or "重发" in all_text):
        return "code_countdown", texts

    # login page: smsLogin visible but getCode not yet visible
    # (getCode appears only AFTER clicking 短信验证码登录 to switch to SMS mode)
    if T["smsLogin"] in all_text:
        return "login_phone", texts

    # attendance page with 签到 or 签退 button
    if T["checkin"] in all_text or T["checkout"] in all_text:
        return "attendance", texts

    # workbench: 考勤打卡 entry visible
    if T["attendance"] in all_text:
        return "workbench", texts

    # home: 工作台 tab visible
    if T["tabWorkbench"] in all_text:
        return "home", texts

    return "unknown", texts


def click_any(d, label, timeout=10):
    """Click by text. Primary: native dump XML bounds; fallback: u2 selector."""
    # strategy 1: native dump XML bounds (primary)
    texts, xml = native_dump_texts(d)
    if label in " ".join(texts):
        if click_xml_bounds(d, xml, label):
            return True
    # strategy 2: u2 text selector (fallback, with wait)
    el = d(text=label)
    if el.exists(timeout=timeout):
        info = el.info
        b = info["bounds"]
        cx, cy = (b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2
        d.click(cx, cy)
        log(f"  click(u2) [{label}] at ({cx},{cy})")
        return True
    # strategy 3: u2 textContains (fallback)
    el = d(textContains=label)
    if el.exists(timeout=5):
        info = el.info
        b = info["bounds"]
        cx, cy = (b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2
        d.click(cx, cy)
        log(f"  click(u2,contains) [{label}] at ({cx},{cy})")
        return True
    log(f"  not found: {label}", "WARN")
    return False


def click_xml_bounds(d, xml_str, keyword):
    """Search the raw XML for any node whose text/desc contains keyword,
    parse its bounds and click the centre."""
    root = ET.fromstring(xml_str)
    for node in root.iter():
        t = node.get("text", "")
        c = node.get("content-desc", "")
        if keyword in t or keyword in c:
            bounds = node.get("bounds", "")
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
            if m:
                cx = (int(m.group(1)) + int(m.group(3))) // 2
                cy = (int(m.group(2)) + int(m.group(4))) // 2
                d.click(cx, cy)
                log(f"  click(xml) [{keyword}] at ({cx},{cy})")
                return True
    return False


# ------------------------------------------------------------------
# flow steps
# ------------------------------------------------------------------
def launch_app(d):
    log("STEP 0: launch app")
    # press home to clear foreground app (e.g. WeChat floating over screen)
    d.press("home")
    time.sleep(1)
    d.app_start(APP_PACKAGE, wait=True)
    time.sleep(TO["appLaunch"])
    log(f"  current package: {d.app_current().get('package')}")


def go_workbench(d):
    log("STEP 1: 工作台 tab")
    if click_any(d, T["tabWorkbench"]):
        time.sleep(TO["pageLoad"])
        return True
    return False


def open_attendance(d):
    log("STEP 2: 考勤打卡")
    if click_any(d, T["attendance"]):
        time.sleep(TO["pageLoad"])
        return True
    log("  scrolling to find...")
    d(scrollable=True).scroll.to(text=T["attendance"])
    if click_any(d, T["attendance"], 5):
        time.sleep(TO["pageLoad"])
        return True
    return False


def do_checkin(d):
    log("STEP 3: 签到/签退 (webview, retry up to 6)")
    dismiss_location_popup(d)
    for i in range(6):
        texts, xml = native_dump_texts(d)
        all_text = " ".join(texts)
        for label in (T["checkin"], T["checkout"]):
            if label in all_text:
                if click_xml_bounds(d, xml, label):
                    log(f"  click {label} attempt {i+1}")
                    time.sleep(TO["pageLoad"])
                    return True
        dismiss_location_popup(d)
        log(f"  not found, retry {i+1}/6")
        time.sleep(3)
    return False


def wait_for_login_page(d, timeout=20):
    """After clicking 签到, poll for login page elements to appear
    in the accessibility tree (webview loads slowly)."""
    log("  waiting for login page to load...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        texts, _ = dump_texts(d)
        all_text = " ".join(texts)
        if T["getCode"] in all_text or T["smsLogin"] in all_text:
            log(f"  login page loaded (texts: {texts[:8]})")
            return True
        time.sleep(1)
    log("  login page not loaded within timeout", "WARN")
    print_screen(d, "wait_login_timeout")
    return False


def wait_for_text(d, text, timeout=15, label=""):
    """Poll for a specific text to appear in the accessibility tree."""
    label = label or text
    log(f"  waiting for [{label}] to appear...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        texts, _ = dump_texts(d)
        if text in " ".join(texts):
            log(f"  [{label}] found")
            return True
        time.sleep(1)
    log(f"  [{label}] not found within {timeout}s", "WARN")
    return False


def wait_for_any(d, texts_to_find, timeout=15, label=""):
    """Poll for any of the given texts to appear in the accessibility tree."""
    label = label or "/".join(texts_to_find)
    log(f"  waiting for [{label}] to appear...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        texts, _ = dump_texts(d)
        all_text = " ".join(texts)
        for t in texts_to_find:
            if t in all_text:
                log(f"  [{label}] found ({t})")
                return True
        time.sleep(1)
    log(f"  [{label}] not found within {timeout}s", "WARN")
    return False


def input_phone(d):
    log("STEP 4: input phone last-4 (custom keypad)")
    for ch in PHONE_INPUT:
        el = d(text=ch)
        if el.exists(timeout=5):
            info = el.info
            b = info["bounds"]
            d.click((b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2)
            log(f"  digit {ch} clicked")
            time.sleep(0.5)
        else:
            log(f"  digit {ch} not found", "WARN")
    time.sleep(1)


def click_sms_login(d):
    log("STEP 5: 短信验证码登录 (switch to SMS mode)")
    if not click_any(d, T["smsLogin"]):
        return False
    # getCode button appears after switching to SMS mode; wait for it
    for i in range(10):
        time.sleep(1)
        texts, _ = dump_texts(d)
        if T["getCode"] in " ".join(texts):
            log(f"  获取验证码 button appeared (after {i+1}s)")
            return True
    log("  获取验证码 button not appeared after sms login", "WARN")
    return True


def request_code(d):
    log("STEP 6: 获取验证码")
    if not click_any(d, T["getCode"]):
        log("  获取验证码按钮未找到,可能已是登录态", "ERROR")
        return False
    # 点击后按钮应变为倒数(如 59s / 60s后重发),轮询确认
    for i in range(10):
        time.sleep(1)
        texts, _ = dump_texts(d)
        for t in texts:
            if re.search(r"\d{1,2}\s*s", t) or "重新获取" in t or "重发" in t:
                log(f"  获取验证码成功,按钮已变倒数: {t}", "OK")
                return True
        log(f"  等待按钮变倒数... (attempt {i+1})")
    # 最后兜底:dump 一次全部文字看看
    print_screen(d, "request_code_timeout")
    log("  获取验证码后未检测到倒数,可能未触发发送", "ERROR")
    return False


# --- verification code retrieval (pushplus via WeChat) ---

def _extract_code(txt):
    if not txt:
        return None
    if not re.search(r"验证码|动态码|code", txt, re.IGNORECASE):
        return None
    patterns = [
        r"验证码为(\d{4,8})",
        r"验证码[\s::是为:]*(\d{4,8})",
        r"动态码[\s::是为:]*(\d{4,8})",
        r"code[\s::]*?(\d{4,8})",
        r"验证码[^\d]{0,10}(\d{4,8})",
    ]
    for p in patterns:
        m = re.search(p, txt, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def _code_from_screen(d):
    texts, _ = dump_texts(d)
    for t in texts:
        c = _extract_code(t)
        if c:
            return c
    return None


def retrieve_code(d):
    log("STEP 7: retrieve code from pushplus WeChat")
    time.sleep(TO["pushplusDelay"])

    deadline = time.time() + TO["waitForCode"]
    w, h = d.window_size()

    # 1. open notification bar (OPPO: swipe from left)
    log("  swipe down from left to open notification bar")
    d.swipe(0.2 * w, 0, 0.2 * w, h // 2, 0.5)
    time.sleep(2)

    # 2. find pushplus notification
    clicked = False
    for attempt in range(5):
        if time.time() > deadline:
            break
        log(f"  search pushplus (attempt {attempt+1})")
        el = d(textContains=T["pushplus"])
        if el.exists(timeout=5):
            info = el.info
            b = info["bounds"]
            d.click((b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2)
            log("  found pushplus, clicked")
            clicked = True
            break
        time.sleep(2)

    if not clicked:
        log("  pushplus not in notification, opening WeChat", "WARN")
        d.swipe(0.2 * w, h // 2, 0.2 * w, 0, 0.5)  # close notification bar
        time.sleep(1)
        d.app_start(WECHAT_PACKAGE, wait=True)
        time.sleep(3)

        el = d(textContains=T["pushplus"])
        if el.exists(timeout=5):
            info = el.info
            b = info["bounds"]
            d.click((b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2)
            time.sleep(2)
        else:
            s = d(description="搜索")
            if s.exists(timeout=5):
                s.click()
                time.sleep(1)
                d.send_keys("pushplus")
                time.sleep(2)
                r = d(textContains="pushplus")
                if r.exists(timeout=5):
                    info = r.info
                    b = info["bounds"]
                    d.click((b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2)
                    time.sleep(2)
    else:
        time.sleep(2)

    log(f"  current package: {d.app_current().get('package')}")

    # 3. in WeChat chat, find last "查看详情" and click
    code = None
    for i in range(10):
        if time.time() > deadline:
            break
        els = d(text=T["viewDetail"])
        count = els.count
        log(f"  查看详情 count={count} (attempt {i+1})")

        if count > 0:
            info = els[count - 1].info
            b = info["bounds"]
            d.click((b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2)
            time.sleep(4)

            code = _code_from_screen(d)
            if code:
                log(f"  got code: {code}", "OK")
                return code

            log("  code not in webview, go back")
            d.press("back")
            time.sleep(2)
        else:
            log("  waiting for pushplus message...")
            time.sleep(3)

    # fallback
    code = _code_from_screen(d)
    if code:
        log(f"  fallback code: {code}", "OK")
        return code

    log("  failed to get code", "ERROR")
    return None


def input_code(d, code):
    log("STEP 8: switch back to app, input code")
    d.app_start(APP_PACKAGE, wait=True)
    time.sleep(TO["appLaunch"])

    et = d(className="android.widget.EditText")
    if et.exists(timeout=5):
        et.click()
        time.sleep(0.3)
        et.set_text(code)
        log(f"  code in EditText: {code}")
    else:
        d.send_keys(code)
        log(f"  code via send_keys: {code}")
    time.sleep(1)
    d.press("back")  # must hide keyboard to see login button
    time.sleep(1)


def submit_login(d):
    log("STEP 9: submit login (短信验证码登录)")
    click_any(d, T["smsLogin"])
    time.sleep(TO["pageLoad"])


def handle_trusted_auth(d):
    """STEP 10 (NEW): detect 可信认证 webview popup, click 取消.

    The popup appears randomly after submitting the SMS login.  It is a
    webview so text may be slow to appear in the accessibility tree.
    We poll for up to ~20 s.  When found we click 取消 via u2 selector,
    falling back to u2 selector if XML bounds fails.
    """
    log("STEP 10: check 可信认证 (trusted authentication)...")

    for i in range(6):
        texts, xml = native_dump_texts(d)
        all_text = " ".join(texts)

        if T["trustedAuth"] in all_text:
            log(f"  可信认证 detected! (poll {i+1})", "WARN")
            shot(d, f"trusted_auth_{i}")

            # strategy 1: native dump XML bounds (primary)
            if click_xml_bounds(d, xml, T["cancel"]):
                log("  click ?? via XML", "OK")
                time.sleep(TO["pageLoad"])
                return True

            # strategy 2: u2 text selector (fallback)
            el = d(text=T["cancel"])
            if el.exists(timeout=5):
                info = el.info
                b = info["bounds"]
                cx, cy = (b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2
                d.click(cx, cy)
                log(f"  click(u2) ?? at ({cx},{cy})", "OK")
                time.sleep(TO["pageLoad"])
                return True

            # strategy 3: u2 textContains (fallback)
            el = d(textContains=T["cancel"])
            if el.exists(timeout=5):
                info = el.info
                b = info["bounds"]
                cx, cy = (b["left"] + b["right"]) // 2, (b["top"] + b["bottom"]) // 2
                d.click(cx, cy)
                log(f"  click(u2,contains) ?? at ({cx},{cy})", "OK")
                time.sleep(TO["pageLoad"])
                return True

            log("  取消 button not found in any strategy!", "ERROR")
            shot(d, "trusted_auth_no_cancel")
            print_screen(d, "trusted_auth_no_cancel")
            return False

        time.sleep(3)

    log("  可信认证 not detected (normal path)")
    return False


def check_result(d):
    log("STEP 11: check result")
    texts, _ = dump_texts(d)
    all_text = " ".join(texts)
    shot(d, "final_result")
    print_screen(d, "final_result")

    if T["codeExpired"] in all_text:
        log("  verification code expired!", "ERROR")
        return False

    if T["smsLogin"] not in all_text and "使用SIM卡认证" not in all_text:
        log("  login dialog gone, likely success", "OK")
        return True

    log("  login state uncertain", "WARN")
    return False


# ------------------------------------------------------------------
# main
# ------------------------------------------------------------------
def main():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    _init_log()
    log("====== attendance checkin started ======")

    d = u2.connect()
    d.implicitly_wait(10)
    info = d.info
    log(f"device: {info.get('productName')} {info.get('displayWidth')}x{info.get('displayHeight')}")

    try:
        # --- detect current state, resume from the right step ---
        state, texts = detect_state(d)
        log(f"detected state: {state}")
        if texts:
            log(f"  screen texts: {texts[:15]}")

        if state == "not_in_app" or state == "unknown":
            launch_app(d)
            # wait for app to load, poll state up to 5 times
            for _ in range(5):
                time.sleep(3)
                state, _ = detect_state(d)
                log(f"  state after launch: {state}")
                if state not in ("unknown", "not_in_app"):
                    break

        if state == "home":
            if not go_workbench(d):
                log("failed: workbench", "ERROR")
                shot(d, "fail_workbench")
                return
            wait_for_text(d, T["attendance"], timeout=10, label="考勤打卡入口")
            state, _ = detect_state(d)

        if state == "workbench":
            if not open_attendance(d):
                log("failed: attendance", "ERROR")
                shot(d, "fail_attendance")
                return
            # attendance page is a webview — wait for 签到 or 签退 button to appear
            wait_for_any(d, [T["checkin"], T["checkout"]], timeout=15, label="签到/签退按钮")
            state, _ = detect_state(d)

        if state == "attendance":
            if not do_checkin(d):
                log("failed: checkin button", "ERROR")
                shot(d, "fail_checkin")
                return
            # login page is a webview — wait for it to load before detecting state
            wait_for_login_page(d, timeout=20)
            state, _ = detect_state(d)
            log(f"  state after checkin: {state}")

        # guard: must be on a login page to continue
        if state not in ("login_phone", "code_countdown"):
            log(f"unexpected state: {state}, cannot continue", "ERROR")
            shot(d, "fail_unexpected_state")
            print_screen(d, "fail_unexpected_state")
            return

        # --- login phase: sequential, no state jumping ---
        if state == "login_phone":
            input_phone(d)
            # only click smsLogin if getCode not yet visible
            texts, _ = dump_texts(d)
            if T["getCode"] not in " ".join(texts):
                click_sms_login(d)
            else:
                log("  获取验证码 already visible, skip sms login click")
            if not request_code(d):
                log("failed: request code", "ERROR")
                shot(d, "fail_request_code")
                return

        # retrieve code -> input -> submit -> trusted-auth -> check
        code = retrieve_code(d)
        if not code:
            log("failed: no verification code", "ERROR")
            shot(d, "fail_no_code")
            return

        input_code(d, code)
        submit_login(d)

        # handle 可信认证 if it appears
        handle_trusted_auth(d)

        ok = check_result(d)
        if ok:
            log("====== checkin success ======", "OK")
        else:
            log("====== checkin uncertain ======", "WARN")

    except Exception as e:
        log(f"exception: {e}", "ERROR")
        import traceback
        traceback.print_exc()
        try:
            shot(d, "exception")
            print_screen(d, "exception")
        except Exception:
            pass
    finally:
        _push_log_to_phone(d)
        _close_log()


if __name__ == "__main__":
    main()
