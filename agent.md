# Attendance Checkin - Agent Guide

## Project Overview
- Path: D:\project\my_py_project\attendance-checkin
- Device: OPPO PJZ110 (1080x2376), Android 36, USB-connected
- adb path: D:\codeTool\codeEnv\flutterEnv\AndroidSdk\platform-tools
- Python: D:\codeTool\codeEnv\python\python.exe

## Cron Architecture (Production)

Phone-side automation runs via Termux + crond + Shizuku (rish):

- **start-cron.sh** -- Termux:Boot script. Starts crond + schedules Shizuku auto-start 10s after boot.
- **checkin_crontab** -- `20 7 * * 1-5` (morning), `31 17 * * 1-5` (evening), `*/10 * * * *` (heartbeat)
- **run_checkin.sh** -- Cron entry. Probes Shizuku via rish, auto-recovers if dead, then runs checkin.sh via rish.
- **start-shizuku.sh** -- Auto-recovers Shizuku server. Discovers adbd port via getprop, connects Termux adb to 127.0.0.1:PORT, runs libshizuku.so. Called by run_checkin.sh and start-cron.sh.
- **heartbeat.sh** -- Every 10 min, logs crond-alive to verify crond is running.
- **checkin.sh** -- Actual checkin flow, runs as shell user via rish. Located at /sdcard/checkin/checkin.sh.
- **rish** -- Shizuku shell bridge. Requires shizuku_server running.

### Shizuku Auto-Recovery Flow
1. run_checkin.sh probes Shizuku: echo 'echo SHIZUKU_OK' | timeout -s KILL 8 sh ~/rish
2. If dead, calls start-shizuku.sh:
   a. getprop service.adb.tcp.port -> port (usually 5555, set by adb tcpip 5555)
   b. adb connect 127.0.0.1:PORT -- Termux adb connects to phone's own adbd
   c. adb shell pm path moe.shizuku.privileged.api -- finds apk, derives libshizuku.so path
   d. adb shell $LIBSO -- starts shizuku_server as shell user
   e. Verifies via rish
3. Then runs checkin.sh via rish

### Limitations
- After phone reboot: service.adb.tcp.port may be empty and port 5555 may not be listening.
  Fix: connect phone to PC via USB and run: adb tcpip 5555
- Termux app user cannot read /proc/net/tcp (Android 16 SELinux restriction).
- mDNS discovery (adb mdns services) does not work from Termux.
- Shizuku app has no intent to auto-start the server.

### Setup Steps (for new device)
1. Install Termux + Termux:Boot, both in battery whitelist
2. Install Shizuku, start server via USB: adb shell /data/app/.../libshizuku.so
3. adb tcpip 5555 -- make adbd listen on port 5555
4. Install android-tools in Termux: pkg install android-tools
5. Copy adb key to Termux ~/.android/adbkey
6. Verify: adb connect 127.0.0.1:5555 from Termux, then adb shell whoami -> shell
7. Copy rish + rish_shizuku.dex from Shizuku app to Termux home
8. Push scripts to Termux home: start-cron.sh, run_checkin.sh, start-shizuku.sh, heartbeat.sh
9. crontab checkin_crontab in Termux
10. Grant: adb shell pm grant com.termux android.permission.WRITE_SECURE_SETTINGS

- Three implementations: checkin.sh (shell, phone-side, primary), checkin.py (Python/u2, PC-driven), lib/flow.js (AutoJS6, deprecated)

## Core Principle: Native uiautomator dump > u2 dump_hierarchy

u2's dump_hierarchy() misses webview-internal nodes (popups, dialogs, buttons inside webviews). Always use `adb shell uiautomator dump` as the primary method for reading screen state.

### What happened
On the attendance page, a "????????" (location error) popup appeared over the ?? button. u2's dump_hierarchy() returned 41 nodes but none of them were the popup ? it was completely invisible. The click on ?? had no effect because the popup was blocking it. Only `adb shell uiautomator dump` revealed the popup and its ?? button.

### Root cause
u2 server and `adb shell uiautomator dump` access the same accessibility tree through different code paths. u2's path sometimes skips webview-internal nodes. Native uiautomator dump is more complete.

### Implementation
- `dump_texts(d)` calls `native_dump_texts(d)` first (adb shell uiautomator dump), falls back to u2's dump_hierarchy() if native fails
- `click_any(d, label)` uses `click_xml_bounds(d, xml, label)` on native dump XML first, u2 text selector as fallback
- `do_checkin(d)` uses `click_xml_bounds` instead of u2 selector for webview buttons
- `handle_trusted_auth(d)` uses `click_xml_bounds` first, u2 selectors as fallback

### When u2 selector still works
- Native Android UI elements (notification bar, WeChat chat, system dialogs)
- Elements outside webviews
- Use u2 selector as fallback when native dump doesn't find the element (with timeout for waiting)

## Webview Button Clicking

Webview elements often have `clickable=false` on the text node itself. The click handler is on a parent container or handled by JavaScript. To click:
1. Get the element's bounds from native dump XML
2. Calculate center coordinates
3. Use `d.click(cx, cy)` to click by coordinates
4. Do NOT use `d(text=label).click()` as it may fail on `clickable=false` elements

## Location Error Popup

The "????????" popup appears randomly on the attendance page, blocking the ??/?? button. It's inside the webview and only visible via native dump. `dismiss_location_popup()` detects and dismisses it before attempting to click ??/??. Called at the start of do_checkin and on each retry.

## Trusted Authentication Popup

The "????" popup appears randomly after submitting SMS login. It's a webview popup with ?? and ?? buttons. `handle_trusted_auth()` polls for it and clicks ?? using native dump XML bounds (strategy 1), falling back to u2 selectors (strategy 2/3).

## Debugging Tips

1. If clicking a button has no effect, dump the screen with `adb shell uiautomator dump` to check for hidden popups/overlays that u2 misses
2. `mCurrentFocus=null` in `dumpsys window` indicates something is blocking focus
3. CDP (Chrome DevTools Protocol) only works if the app's webview has debugging enabled ? check the socket belongs to the right PID (not WeChat's)
4. Compare u2 dump and native dump outputs when troubleshooting missing elements
5. dump_screen.py and dump_webview.py are debug scripts for on-device inspection

## Flow Steps

1. launch_app ? press home, start app, poll for state
2. go_workbench ? click ??? tab
3. open_attendance ? click ???? entry
4. do_checkin ? dismiss location popup, click ??/?? via XML bounds
5. input_phone ? click digits 2,4,4,9 on custom keypad
6. click_sms_login ? click ???????, wait for ????? button
7. request_code ? click ?????, verify countdown (60s) confirms SMS sent
8. retrieve_code ? open notification bar, find pushplus, open WeChat, click ????, extract code from webview
9. input_code ? switch back to app, fill EditText with code
10. submit_login ? click ????????
11. handle_trusted_auth ? poll for ???? popup, click ?? if it appears
12. check_result ? verify login dialog is gone

## State Detection Priority (detect_state)

Login page checks come BEFORE attendance check, because when the login webview overlays the attendance page, both ?? and smsLogin texts are visible. Priority order:
1. not_in_app (wrong package)
2. login_phone (getCode visible)
3. code_countdown (smsLogin + countdown regex)
4. login_phone (smsLogin visible, no getCode yet)
5. attendance (?? or ?? visible)
6. workbench (???? entry visible)
7. home (??? tab visible)
8. unknown

## Config
- APP_PACKAGE: com.cmri.ercs.yqx
- WECHAT_PACKAGE: com.tencent.mm
- PHONE_INPUT: 2449 (last 4 digits, custom keypad)
- .gitignore has *.py ? must use `git add -f` for Python files
- Files should be LF line-ending, UTF-8 without BOM
