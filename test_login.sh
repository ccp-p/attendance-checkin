#!/system/bin/sh
# Standalone test for the SMS-login + verification-code scenario.
# Runs navigation, login page, phone input, get-code tap and PushPlus
# polling only. Never submits the code or performs a checkin.
# Usage: sh /sdcard/checkin/test_login.sh

CHECKIN_LIB_ONLY=1
. /sdcard/checkin/checkin.sh

tlog() { echo "[TEST $(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

tlog "====== login test started ======"
rm -f /sdcard/checkin/.cache_* 2>/dev/null
input keyevent 224 >/dev/null 2>&1
sleep 1
AUTO_ROT=$(settings get system accelerometer_rotation 2>/dev/null)
lock_rotation
SCREEN_TIMEOUT=$(settings get system screen_off_timeout 2>/dev/null)
settings put system screen_off_timeout 600000 2>/dev/null

tlog "STEP A: launch app"
am force-stop "$APP_PACKAGE"; sleep 1
input keyevent KEYCODE_HOME; sleep 1
am start -n "$APP_PACKAGE/com.cmic.module_main.ui.activity.WelcomeActivity" 2>/dev/null
sleep "$TO_LAUNCH"

tlog "STEP B: navigate to attendance"
if ! open_attendance_fixed; then
    tlog "FAILED: navigation"
    restore_rotation 2>/dev/null
    [ -n "$SCREEN_TIMEOUT" ] && settings put system screen_off_timeout "$SCREEN_TIMEOUT" 2>/dev/null
    exit 1
fi
sleep "$TO_PAGE"

tlog "STEP C: tap attendance button until login page appears"
login_seen=0
for ci in 1 2 3 4 5 6; do
    invalidate_dump
    if text_exists "$T_CHECKOUT" || text_exists "$T_CHECKIN" || attendance_title_exists; then
        if tap_attendance_button; then login_seen=1; break; fi
    fi
    tlog "  retry ($ci): re-navigating"
    goto_attendance || true
    sleep 2
done
if [ "$login_seen" -eq 0 ]; then
    tlog "FAILED: attendance button"
    restore_rotation 2>/dev/null
    [ -n "$SCREEN_TIMEOUT" ] && settings put system screen_off_timeout "$SCREEN_TIMEOUT" 2>/dev/null
    exit 1
fi
if ! wait_for_any "$T_GET_CODE" "$T_SMS_LOGIN" "$TO_LOGIN"; then
    tlog "FAILED: login page did not appear"
    restore_rotation 2>/dev/null
    [ -n "$SCREEN_TIMEOUT" ] && settings put system screen_off_timeout "$SCREEN_TIMEOUT" 2>/dev/null
    exit 1
fi

tlog "STEP D: input phone"
dump_ui 2>/dev/null
if ! grep -q "$T_GET_CODE" "$UI_DUMP" 2>/dev/null; then
    tap_screen_button 540 1401 "$T_GET_CODE" || { tlog "FAILED: sms login tap"; exit 1; }
fi
sleep 1
for d in $(echo "$PHONE_INPUT" | sed 's/./& /g'); do
    case "$d" in
        1) input tap 186 1791 ;;
        2) input tap 540 1791 ;;
        3) input tap 894 1791 ;;
        4) input tap 186 1936 ;;
        5) input tap 540 1936 ;;
        6) input tap 894 1936 ;;
        7) input tap 186 2080 ;;
        8) input tap 540 2080 ;;
        9) input tap 894 2080 ;;
        0) input tap 540 2226 ;;
    esac
    sleep 0.5
done
invalidate_dump
sleep 1

tlog "STEP E: baseline + get-code tap"
pp_pre_key=$(get_pp_access_key)
if [ -n "$pp_pre_key" ]; then
    echo '{"current":1,"pageSize":3}' > "$PP_LIST_BODY"
    curl -s --max-time 10 -X POST "$PP_API_BASE/api/open/message/list/" \
        -H 'Content-Type: application/json' \
        -H "access-key: $pp_pre_key" \
        -d @"$PP_LIST_BODY" 2>/dev/null | grep -o '"shortCode":"[^"]*"' | head -1 | sed 's/"shortCode":"//;s/"//' > /sdcard/pp_baseline.txt
    tlog "  baseline: $(cat /sdcard/pp_baseline.txt 2>/dev/null)"
fi
invalidate_dump
input tap 870 1303

tlog "STEP F: poll PushPlus for code"
code=$(get_code "870 1303")
if [ -z "$code" ]; then
    tlog "  fallback: tap 870 1207"
    input tap 870 1207
    code=$(get_code "870 1207")
fi

if [ -n "$code" ]; then
    tlog "SUCCESS: got code $code (not submitted)"
else
    tlog "FAILED: no code received"
fi

restore_rotation 2>/dev/null
[ -n "$SCREEN_TIMEOUT" ] && settings put system screen_off_timeout "$SCREEN_TIMEOUT" 2>/dev/null
tlog "====== login test finished ======"
[ -n "$code" ]
