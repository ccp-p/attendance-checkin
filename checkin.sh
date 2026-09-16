#!/system/bin/sh
# Attendance checkin - phone-side, triggered by cron via rish
# Uses pushplus WeChat forwarding for SMS code retrieval

APP_PACKAGE="com.cmri.ercs.yqx"
PHONE_INPUT="2449"
DIR="/sdcard/checkin"
LOG_FILE="$DIR/checkin.log"
SHOT_DIR="$DIR/screenshots"
UI_DUMP="/sdcard/ui_dump.xml"
RUN_LOCK="$DIR/.running"

# pushplus API credentials for verification code retrieval
PP_TOKEN="821c4bffa77242268d9664c3e3a24cce"
PP_SECRET_KEY="ogIU753RWNhMVOdUMn-3gHm4LvRI"
PP_API_BASE="https://www.pushplus.plus"

T_WORKBENCH="工作台"
T_ATTENDANCE="考勤打卡"
T_CHECKIN="签到"
T_CHECKOUT="签退"
T_SMS_LOGIN="短信验证码登录"
T_GET_CODE="获取验证码"
T_PUSHPLUS="pushplus"
T_VIEW_DETAIL="查看详情"
T_TRUSTED_AUTH="可信认证"
T_TRUSTED_AUTH_PLATFORM="可信认证平台"
T_CANCEL="取消"
T_SIGNIN_SUCCESS="签到成功"
T_CHECKOUT_SUCCESS="签退成功"
T_CHECKIN_SUCCESS="打卡成功"
T_LOC_ERROR="位置信息获取失败"
T_CODE_EXPIRED="短信验证码过期或不存在"
WECHAT_PKG="com.tencent.mm"

T_CONFIRM_CHECKIN="确认打卡"

TO_FIND=5
TO_PAGE=2
TO_LAUNCH=3
TO_LOGIN=12
TO_CODE=210
TO_PUSHPLUS_DELAY=8
TO_WX_LOAD=2

# UI coordinates calibrated on device (1080x2376)
COORD_TRUST_BACK="86 203"     # 可信认证 左上角返回按钮
COORD_WORKBENCH_TAB="324 2295"
COORD_ATTENDANCE_CARD="675 1640"
COORD_ATTENDANCE_BUTTON="540 1300"

# pushplus polling interval (seconds between API calls)
TO_PP_POLL=5

# Temporary files for pushplus API
PP_KEY_BODY="/sdcard/pp_key.json"
PP_LIST_BODY="/sdcard/pp_list.json"
PP_RESP="/sdcard/pp_resp.json"

mkdir -p "$DIR" "$SHOT_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

# ColorOS can turn concurrent UI commands into failed binder transactions
# (am/settings/input all report Failed transaction). Make checkin single-run.
if [ -d "$RUN_LOCK" ]; then
    OLD_PID=$(cat "$RUN_LOCK/pid" 2>/dev/null)
    if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
        rm -rf "$RUN_LOCK"
    fi
fi
if ! mkdir "$RUN_LOCK" 2>/dev/null; then
    log "another checkin process is already running; aborting"
    exit 1
fi
echo $$ > "$RUN_LOCK/pid"

# Auto-rotation state saved on entry, restored on exit
AUTO_ROT=""
SCREEN_TIMEOUT=""
restore_rotation() {
    if [ -n "$AUTO_ROT" ]; then
        settings put system accelerometer_rotation "$AUTO_ROT" 2>/dev/null
        settings put system user_rotation 0 2>/dev/null
    fi
}
restore_device_state() {
    restore_rotation
    svc power stayon false >/dev/null 2>&1
    if [ -n "$SCREEN_TIMEOUT" ]; then
        settings put system screen_off_timeout "$SCREEN_TIMEOUT" 2>/dev/null
    fi
}
trap 'restore_device_state; rm -rf "$RUN_LOCK" 2>/dev/null' EXIT

lock_rotation() {
    settings put system accelerometer_rotation 0 2>/dev/null
    settings put system user_rotation 0 2>/dev/null
}

# Cache flag - 1 means current dump is still valid
DUMP_VALID=0
invalidate_dump() { DUMP_VALID=0; }
force_dump() { DUMP_VALID=0; dump_ui; }
shot() { screencap -p "$SHOT_DIR/$1.png" 2>/dev/null; log "  shot: $1"; }

dump_ui() {
    if [ "$DUMP_VALID" -eq 1 ] && [ -f "$UI_DUMP" ] && [ -s "$UI_DUMP" ]; then return 0; fi
    lock_rotation
    rm -f "$UI_DUMP"
    uiautomator dump "$UI_DUMP" 2>/dev/null
    if [ -f "$UI_DUMP" ] && [ -s "$UI_DUMP" ]; then DUMP_VALID=1; return 0; fi
    sleep 1
    uiautomator dump "$UI_DUMP" 2>/dev/null
    if [ -f "$UI_DUMP" ] && [ -s "$UI_DUMP" ]; then DUMP_VALID=1; return 0; fi
    log "  dump failed"; return 1
}

text_exists() { dump_ui || return 1; grep -q "$1" "$UI_DUMP" 2>/dev/null; }

wait_for_text() {
    local text="$1"
    local timeout="$2"
    local dl=$(( $(date +%s) + timeout ))
    while [ $(date +%s) -lt $dl ]; do
        if text_exists "$text"; then return 0; fi
        invalidate_dump
        sleep 1
    done
    return 1
}

wait_for_any() {
    local t1="$1"
    local t2="$2"
    local timeout="$3"
    local dl=$(( $(date +%s) + timeout ))
    while [ $(date +%s) -lt $dl ]; do
        if text_exists "$t1" || text_exists "$t2"; then return 0; fi
        invalidate_dump
        sleep 1
    done
    return 1
}

click_text() {
    local text="$1"
    dump_ui || return 1
    local line
    line=$(cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep "text=\"$text\"" | head -1)
    if [ -z "$line" ]; then log "  not found: $text"; return 1; fi
    local bounds
    bounds=$(echo "$line" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
    if [ -z "$bounds" ]; then log "  no bounds: $text"; return 1; fi
    local nums
    nums=$(echo "$bounds" | sed 's/\]\[/,/g; s/[^0-9,]//g')
    local x1 y1 x2 y2 cx cy
    x1=$(echo "$nums" | cut -d, -f1)
    y1=$(echo "$nums" | cut -d, -f2)
    x2=$(echo "$nums" | cut -d, -f3)
    y2=$(echo "$nums" | cut -d, -f4)
    cx=$(( (x1 + x2) / 2 ))
    cy=$(( (y1 + y2) / 2 ))
    input tap "$cx" "$cy"
    log "  click $text at $cx,$cy"
    return 0
}

# Click the last (newest) matching text element - for WeChat messages
click_text_last() {
    local text="$1"
    dump_ui || return 1
    local line
    line=$(cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep "text=\"$text\"" | tail -1)
    if [ -z "$line" ]; then log "  not found: $text"; return 1; fi
    local bounds
    bounds=$(echo "$line" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
    if [ -z "$bounds" ]; then log "  no bounds: $text"; return 1; fi
    local nums
    nums=$(echo "$bounds" | sed 's/\]\[/,/g; s/[^0-9,]//g')
    local x1 y1 x2 y2 cx cy
    x1=$(echo "$nums" | cut -d, -f1)
    y1=$(echo "$nums" | cut -d, -f2)
    x2=$(echo "$nums" | cut -d, -f3)
    y2=$(echo "$nums" | cut -d, -f4)
    cx=$(( (x1 + x2) / 2 ))
    cy=$(( (y1 + y2) / 2 ))
    input tap "$cx" "$cy"
    log "  click last $text at $cx,$cy"
    return 0
}

click_text_wait() {
    if wait_for_text "$1" "$2"; then click_text "$1"; return $?; fi
    log "  timeout: $1"; return 1
}

click_xy() { input tap "$1" "$2"; invalidate_dump; log "  tap ($1,$2)"; }

# --- Coordinate cache ---
# Find text bounds from current dump (no extra dump needed)
find_bounds() {
    local text="$1"
    local line
    line=$(cat "$UI_DUMP" 2>/dev/null | sed 's/<node/\n<node/g' | grep 'text="'"$text"'"' | head -1)
    [ -z "$line" ] && return 1
    local bounds
    bounds=$(echo "$line" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
    [ -z "$bounds" ] && return 1
    local nums
    nums=$(echo "$bounds" | sed 's/\]\[/,/g; s/[^0-9,]//g')
    local x1 y1 x2 y2 cx cy
    x1=$(echo "$nums" | cut -d, -f1); y1=$(echo "$nums" | cut -d, -f2)
    x2=$(echo "$nums" | cut -d, -f3); y2=$(echo "$nums" | cut -d, -f4)
    cx=$(( (x1 + x2) / 2 )); cy=$(( (y1 + y2) / 2 ))
    echo "$cx $cy"
    return 0
}

# Click text using cached coords if available, else dump+find+cache
# Usage: click_cached VARNAME "text"
# Cache: click text, store coords in named global var
# Usage: click_cached CACHE_VAR "text"
click_cached() {
    local cv="$1" text="$2"
    # Read cached value
    local val
    val=$(cat /sdcard/checkin/.cache_"$cv" 2>/dev/null)
    if [ -n "$val" ]; then
        input tap $val
        log "  click cached $text at $val"
        invalidate_dump
        return 0
    fi
    # Not cached - find via dump
    dump_ui || return 1
    local coords
    coords=$(find_bounds "$text")
    if [ -z "$coords" ]; then
        log "  not found: $text"
        return 1
    fi
    echo "$coords" > /sdcard/checkin/.cache_"$cv"
    input tap $coords
    log "  click $text at $coords (cached)"
    invalidate_dump
    return 0
}

# Extract verification code from UI dump XML text nodes
# Matches: 验证码为123456, 验证码:1234, 动态码123456, code:1234
extract_code_from_dump() {
    local texts
    texts=$(cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep -o 'text="[^"]*"' | sed 's/text="//;s/"//')
    local code
    code=$(echo "$texts" | grep -oE '验证码[^0-9]{0,10}[0-9]{4,8}' | grep -oE '[0-9]{4,8}' | head -1)
    if [ -n "$code" ]; then echo "$code"; return 0; fi
    code=$(echo "$texts" | grep -oE '动态码[^0-9]{0,10}[0-9]{4,8}' | grep -oE '[0-9]{4,8}' | head -1)
    if [ -n "$code" ]; then echo "$code"; return 0; fi
    code=$(echo "$texts" | grep -oiE 'code[^0-9]{0,10}[0-9]{4,8}' | grep -oE '[0-9]{4,8}' | head -1)
    if [ -n "$code" ]; then echo "$code"; return 0; fi
    return 1
}

# Get pushplus AccessKey (fresh each run, expires in 7200s)
get_pp_access_key() {
    local resp key
    resp=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/common/openApi/getAccessKey" \
        -H 'Content-Type: application/json' \
        -d "{\"token\":\"$PP_TOKEN\",\"secretKey\":\"$PP_SECRET_KEY\"}" 2>/dev/null)
    if [ -z "$resp" ]; then
        log "  pp: empty access key response"
        return 1
    fi
    # Parse: {"code":200,"data":{"accessKey":"xxx","expiresIn":"7200"}}
    key=$(echo "$resp" | grep -o '"accessKey":"[^"]*"' | head -1 | sed 's/"accessKey":"//;s/"//')
    if [ -z "$key" ]; then
        log "  pp: access key parse failed: $resp"
        return 1
    fi
    echo "$key"
}

# Extract verification code from a text string.
# Matches: 验证码为123456, 验证码:1234, 动态码123456, code:1234, etc.
# Extract 6-digit verification code from a message title.
# Skips pure-number titles (sender IDs like 10658104506) by
# requiring the title to be longer than 10 characters.
extract_code_from_text() {
    local text="$1"
    echo "$text" | while IFS= read -r line; do
        if [ ${#line} -gt 10 ]; then
            local c
            c=$(echo "$line" | grep -oE '[0-9]{6}' | head -1)
            if [ -n "$c" ]; then echo "$c"; return 0; fi
        fi
    done
    return 1
}

# Retrieve verification code via pushplus open API.
# Polls message list for new messages (by shortCode) and extracts
# the 6-digit code from SMS content titles.
get_code() {
    local dl=$(( $(date +%s) + TO_CODE ))
    local code=""

    log "  pp: getting access key..."
    local access_key
    access_key=$(get_pp_access_key)
    if [ -z "$access_key" ]; then
        log "  pp: failed to get access key"
        return 1
    fi
    log "  pp: access key obtained"

    echo '{"current":1,"pageSize":3}' > "$PP_LIST_BODY"

    # Read baseline recorded BEFORE clicking "获取验证码" (in STEP 5.5).
    # This ensures the SMS code message is always "new" relative to baseline.
    local latest_sc
    latest_sc=$(cat /sdcard/pp_baseline.txt 2>/dev/null)
    log "  pp: baseline shortCode: ${latest_sc:-none}"

    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        if [ $(date +%s) -ge $dl ]; then break; fi

        log "  pp: polling (attempt $i)..."
        local resp
        resp=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/open/message/list" \
            -H 'Content-Type: application/json' \
            -H "access-key: $access_key" \
            -d @"$PP_LIST_BODY" 2>/dev/null)
        if [ -z "$resp" ]; then
            log "  pp: empty response"
            sleep "$TO_PP_POLL"
            continue
        fi

        echo "$resp" > "$PP_RESP"

        if echo "$resp" | grep -q '"code":40'; then
            log "  pp: refreshing access key..."
            access_key=$(get_pp_access_key)
            [ -z "$access_key" ] && return 1
            continue
        fi

        # Check if newest shortCode changed (new message arrived)
        new_sc=$(echo "$resp" | grep -o '"shortCode":"[^"]*"' | head -1 | sed 's/"shortCode":"//;s/"//')
        if [ "$new_sc" = "$latest_sc" ]; then
            if [ $i -eq 1 ] || [ $((i % 6)) -eq 0 ]; then
                latest_time=$(echo "$resp" | grep -o '"updateTime":"[^"]*"' | head -1 | sed 's/"updateTime":"//;s/"//')
                log "  pp: waiting (latest PushPlus: ${latest_time:-unknown})"
            fi
            sleep "$TO_PP_POLL"
            continue
        fi

        # New message arrived! Extract code from titles (newest first)
        echo "$resp" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"$//' > /sdcard/pp_titles.txt
        while IFS= read -r ti; do
            # Skip short titles
            [ ${#ti} -le 10 ] && continue
            # Skip pure-number titles (sender IDs like 10658104506)
            case "$ti" in *[!0-9]*) ;; *) continue;; esac
            # Extract 6-digit code
            code=$(echo "$ti" | grep -oE '[0-9]{6}' | head -1)
            if [ -n "$code" ]; then
                log "  pp: got code: $code (from: $ti)"
                echo "$code"
                rm -f /sdcard/pp_titles.txt
                return 0
            fi
        done < /sdcard/pp_titles.txt
        rm -f /sdcard/pp_titles.txt

        log "  pp: new message arrived, but no usable code"
        log "  pp: no new code yet"
        sleep "$TO_PP_POLL"
    done

    log "  pp: timed out"
    return 1
}

check_trusted() {
    if text_exists "$T_TRUSTED_AUTH" || text_exists "$T_TRUSTED_AUTH_PLATFORM"; then
       log "  trusted auth popup!"; shot "trusted_popup"
       input tap $COORD_TRUST_BACK; sleep 1
       shot "trusted_after_back"; return 0
    fi
    return 1
}

checkin_success_exists() {
    text_exists "$T_CHECKIN_SUCCESS" || text_exists "$T_SIGNIN_SUCCESS" || text_exists "$T_CHECKOUT_SUCCESS"
}

trusted_visible() {
    text_exists "$T_TRUSTED_AUTH" || text_exists "$T_TRUSTED_AUTH_PLATFORM"
}

# After trusted auth, one back may go straight to the result screen. Poll the
# fresh dump first; never send a blind second back when trusted UI is gone.
handle_trusted() {
    log "  checking trusted auth..."
    trusted_seen=0
    trusted_back_count=0
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        invalidate_dump
        if checkin_success_exists; then
            log "  checkin success popup detected"
            shot "trusted_success"
            return 0
        fi

        if trusted_visible; then
            trusted_seen=1
            log "  trusted auth detected (poll $i)"
            shot "trusted"
            input tap $COORD_TRUST_BACK
            trusted_back_count=$((trusted_back_count + 1))
            sleep 1
            continue
        fi

        if [ "$trusted_seen" -eq 1 ]; then
            if [ "$trusted_back_count" -eq 0 ]; then
                # Safety net: dump may briefly miss the trusted page.
                input tap $COORD_TRUST_BACK
                trusted_back_count=1
                sleep 1
                continue
            fi

            # Trusted page is gone after the first back. Wait for the result
            # popup instead of clicking back again and leaving the flow.
            log "  trusted page gone after back; waiting for result"
            sleep 1
            continue
        fi

        sleep 1
    done
    log "  no success popup after trusted handling"
    return 1
}

print_screen() {
    dump_ui || return 1
    cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep -o 'text="[^"]*"' | sed 's/text="//;s/"//' | grep -v '^$' | head -20 >> "$LOG_FILE"
}

# Restart the flow from scratch when the current attempt has gone wrong.
# The flow runs via rish (Shizuku adb shell), so am/settings/input keep
# working after the exec handover to the fresh copy.
restart_flow() {
    RETRY_COUNT="${RETRY_COUNT:-0}"
    if [ "$RETRY_COUNT" -lt 2 ]; then
        RETRY_COUNT=$((RETRY_COUNT + 1))
        export RETRY_COUNT
        log "  restart flow (attempt $RETRY_COUNT/2): $1"
        am force-stop "$APP_PACKAGE" >/dev/null 2>&1; sleep 2
        input keyevent KEYCODE_HOME >/dev/null 2>&1; sleep 1
        # Probe the workbench explicitly so the post-restart log shows what
        # the fresh launch actually renders (diagnoses silent stuck loops).
        invalidate_dump
        dump_ui >/dev/null 2>&1
        log "  post-restart dump: workbench=$(grep -q "$T_WORKBENCH" "$UI_DUMP" 2>/dev/null && echo yes || echo no) attendance=$(grep -q "$T_ATTENDANCE" "$UI_DUMP" 2>/dev/null && echo yes || echo no)"
        exec "$0" "$@"
    fi
    log "  max flow restarts reached"
    return 1
}

fail() {
    log "FAILED: $1"; shot "fail_$(date +%s)"; print_screen
    log "====== checkin failed ======"; exit 1
}

# Detect which page the app is currently on.
# Returns 0 if on attendance page, 1 if on workbench/home, 2 if unknown.
detect_page() {
    dump_ui || return 2
    if grep -q "$T_ATTENDANCE" "$UI_DUMP" 2>/dev/null && grep -q "$T_CHECKOUT" "$UI_DUMP" 2>/dev/null; then
        return 0
    fi
    if grep -q "$T_WORKBENCH" "$UI_DUMP" 2>/dev/null; then
        return 1
    fi
    return 2
}

# Click the native action-bar back button (resource-id). H5 pages such as
# 外勤申请 intercept KEYCODE_BACK and never exit, so system Back is useless
# there - only the action-bar button reliably returns to the workbench.
click_back_actionbar() {
    dump_ui || return 1
    local line
    line=$(cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep 'btn_back_actionbar' | head -1)
    if [ -z "$line" ]; then log "  no back actionbar button"; return 1; fi
    local bounds
    bounds=$(echo "$line" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
    [ -z "$bounds" ] && return 1
    local nums
    nums=$(echo "$bounds" | sed 's/\]\[/,/g; s/[^0-9,]//g')
    local cx cy
    cx=$(( ( $(echo "$nums" | cut -d, -f1) + $(echo "$nums" | cut -d, -f3) ) / 2 ))
    cy=$(( ( $(echo "$nums" | cut -d, -f2) + $(echo "$nums" | cut -d, -f4) ) / 2 ))
    input tap "$cx" "$cy"
    log "  click back actionbar at $cx,$cy"
    sleep 1
    return 0
}

# Verify the attendance page actually loaded (签到/签退 visible).
# Workbench grid can still be re-laying-out when 考勤打卡 is tapped, so the
# tap may land on an adjacent card (e.g. 外勤申请). Always confirm landing.
attendance_title_exists() {
    dump_ui || return 1
    grep 'tv_title_actionbar' "$UI_DUMP" 2>/dev/null | grep -q "$T_ATTENDANCE"
}

# The attendance H5 can swallow one input event even though it exits 0.
# Alternate tap/swipe touches and require the login page before returning.
tap_attendance_button() {
    local i
    for i in 1 2 3 4 5 6; do
        case "$i" in
            1|3|5) input tap $COORD_ATTENDANCE_BUTTON ;;
            2|4|6) input swipe $COORD_ATTENDANCE_BUTTON $COORD_ATTENDANCE_BUTTON 200 ;;
        esac
        sleep 2
        if wait_for_any "$T_GET_CODE" "$T_SMS_LOGIN" 8; then
            log "  login page appeared after attendance-button touch $i"
            return 0
        fi
        invalidate_dump
    done
    log "  attendance button did not open login page"
    return 1
}

# Generic ColorOS/WebView touch retry for a fixed H5 button. It only returns
# after the requested H5 state is visible in a fresh dump.
tap_screen_button() {
    local x="$1" y="$2" success_text="$3"
    local i
    for i in 1 2 3 4 5 6; do
        case "$i" in
            1|3|5) input tap "$x" "$y" ;;
            2|4|6) input swipe "$x" "$y" "$x" "$y" 200 ;;
        esac
        sleep 2
        if wait_for_text "$success_text" 8; then
            log "  touched button at $x,$y (attempt $i), $success_text visible"
            return 0
        fi
        invalidate_dump
    done
    log "  button touch did not make $success_text visible"
    return 1
}

wait_attendance_page() {
    local i
    # Attendance H5 takes 6-9s to render 签到/签退; poll ~30s to be safe.
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        invalidate_dump
        # ColorOS/WebView sometimes hides the H5 button from a fresh dump.
        # The native action-bar title is still reliable after the card opens.
        if text_exists "$T_CHECKIN" || text_exists "$T_CHECKOUT" || attendance_title_exists; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# Click 考勤打卡 from the workbench and confirm the attendance page loaded.
# On wrong landing: press BACK to return to workbench and retry once.
open_attendance_from_workbench() {
    click_text_wait "$T_ATTENDANCE" 5 || { log "  timeout: $T_ATTENDANCE"; return 1; }
    if wait_attendance_page; then
        return 0
    fi
    log "  landed on wrong page after $T_ATTENDANCE, going back and retrying"
    click_back_actionbar || input keyevent KEYCODE_BACK
    sleep 1
    invalidate_dump
    click_text "$T_WORKBENCH" 2>/dev/null; sleep "$TO_PAGE"
    click_text_wait "$T_ATTENDANCE" 5 || { log "  retry timeout: $T_ATTENDANCE"; return 1; }
    if wait_attendance_page; then
        return 0
    fi
    log "  attendance page still not loaded after retry"
    return 1
}

# Navigate to the attendance page regardless of current state.
goto_attendance() {
    detect_page
    case $? in
        0) log "  already on attendance page"; return 0 ;;
        1) log "  on workbench, navigating to attendance"
           click_text "$T_WORKBENCH"; sleep "$TO_PAGE"
           open_attendance_from_workbench ;;
        2) log "  unknown page, trying workbench first"
           if ! click_text_wait "$T_WORKBENCH" 5; then
               # App relaunch can restore a tab-less H5 page (e.g. 外勤申请,
               # EnterpriseH5ProcessActivity) where the workbench tab is gone
               # and KEYCODE_BACK is intercepted. Use the native back button.
               log "  no workbench tab, clicking native back button"
               click_back_actionbar; sleep 1
               invalidate_dump
               if ! click_text_wait "$T_WORKBENCH" 5; then
                   click_back_actionbar; sleep 1
                   invalidate_dump
                   click_text_wait "$T_WORKBENCH" 5 || { log "  timeout: $T_WORKBENCH after back"; return 1; }
               fi
           fi
           sleep "$TO_PAGE"
           open_attendance_from_workbench ;;
    esac
}

# Launch animation / "接收中..." can keep uiautomator dump from reaching idle.
# Use calibrated fixed coordinates for the first workbench/card tap only.
# Always verify the attendance page afterwards; a stale or shifted workbench
# can otherwise send the blind attendance-button tap to 外勤申请.
open_attendance_fixed() {
    log "  fixed navigation: workbench tab + attendance card"
    input tap $COORD_WORKBENCH_TAB
    sleep 2
    input tap $COORD_ATTENDANCE_CARD
    sleep 8

    if wait_attendance_page; then
        log "  attendance page verified after fixed navigation"
        return 0
    fi

    log "  fixed navigation failed; recovering via workbench texts"
    goto_attendance || return 1
    if wait_attendance_page; then
        log "  attendance page verified after text recovery"
        return 0
    fi

    return 1
}

# A location validation failure means the current check-in attempt failed.
# Close the attendance H5, explicitly return through the workbench tab, and
# reopen attendance. The caller continues with a fresh sign-in/checkout tap.
recover_location_error() {
    log "  location validation failed; reloading attendance from workbench"
    shot "location_error"

    click_back_actionbar || input keyevent KEYCODE_BACK
    sleep 1
    invalidate_dump

    if ! click_text_wait "$T_WORKBENCH" 5; then
        click_back_actionbar || input keyevent KEYCODE_BACK
        sleep 1
        invalidate_dump
        click_text_wait "$T_WORKBENCH" 5 || { log "  timeout: workbench after location error"; return 1; }
    fi

    sleep "$TO_PAGE"
    open_attendance_from_workbench
}

main() {
    log "====== checkin started ======"
    # Clear coordinate cache
    rm -f /sdcard/checkin/.cache_* 2>/dev/null
    # Wake up screen (cron runs while screen is off)
    input keyevent 224 >/dev/null 2>&1
    sleep 1
    # Save auto-rotation state, then disable it (uiautomator dump tends to turn it on)
    AUTO_ROT=$(settings get system accelerometer_rotation 2>/dev/null)
    lock_rotation
    # Keep the display awake for the whole flow; H5 loading can take 6-9s.
    SCREEN_TIMEOUT=$(settings get system screen_off_timeout 2>/dev/null)
    settings put system screen_off_timeout 600000 2>/dev/null

    log "STEP 0: wake screen & launch"
    # Force-stop app to guarantee fresh initial state
    am force-stop "$APP_PACKAGE"; sleep 1
    input keyevent KEYCODE_HOME; sleep 1
    invalidate_dump
    # Use am start instead of monkey: monkey injects rotation events that
    # enable auto-rotation on Android 14+ (see MonkeyRotationEven#injectEvent
    # in dumpsys window RotationLockHistory)
    am start -n "$APP_PACKAGE/com.cmic.module_main.ui.activity.WelcomeActivity" 2>/dev/null
    sleep "$TO_LAUNCH"

    log "STEP 1: navigate to attendance"
    open_attendance_fixed || fail "fixed navigation"
    sleep "$TO_PAGE"
    invalidate_dump

    log "STEP 2: checkin/checkout"
    # Retry loop: click 签到 or 签退, then verify page actually changed.
    # WebView may still be loading, so stale "签到" text can appear even
    # when the real button is "签退". Fix: after clicking, check if login
    # page appeared; if not, retry with fresh dump.
    checkin_done=0
    for ci in 1 2 3 4 5 6; do
        # A location error invalidates the attempt. Reload attendance from
        # the workbench, then try the sign-in/checkout button again below.
        if text_exists "$T_LOC_ERROR"; then
            if ! recover_location_error; then fail "location recovery"; fi
        fi
        # Fresh dump for checkin/checkout (WebView may still be loading)
        invalidate_dump
        # The H5 button can be missing from a WebView dump even while the
        # native title confirms we are on the attendance page. Only now is
        # the calibrated button safe; without the title we must re-navigate.
        if text_exists "$T_CHECKOUT" || text_exists "$T_CHECKIN" || attendance_title_exists; then
            log "  attendance page title confirmed, H5 button hidden in dump"
            if tap_attendance_button; then
                checkin_done=1
                break
            fi
        fi

        log "  retry checkin ($ci)"
        # Never keep waiting on a wrong page (e.g. 外勤申请). Re-navigate
        # before every retry; goto_attendance handles both wrong H5 pages and
        # the normal workbench state.
        log "  re-navigating to attendance"
        goto_attendance || { fail "attendance re-nav"; }
        sleep 2
    done
    if [ "$checkin_done" -eq 0 ]; then fail "checkin btn"; fi
    sleep "$TO_PAGE"
    invalidate_dump

    # Handle early-leave confirmation popup ("你早退了" / "确认打卡")
    if text_exists "$T_CONFIRM_CHECKIN"; then
        log "  early-leave popup detected, clicking 确认打卡"
        click_text "$T_CONFIRM_CHECKIN"
        sleep "$TO_PAGE"
        invalidate_dump
    fi

    log "STEP 3: wait login"
    if ! wait_for_any "$T_GET_CODE" "$T_SMS_LOGIN" "$TO_LOGIN"; then
        invalidate_dump
        if text_exists "$T_LOC_ERROR"; then
            log "  location error appeared after check button"
            if ! recover_location_error; then fail "location recovery"; fi

            # Continue the full verification flow with a fresh button tap.
            if ! click_text "$T_CHECKOUT"; then
                click_text "$T_CHECKIN" || fail "checkin btn after location recovery"
            fi
            sleep "$TO_PAGE"
            invalidate_dump
        fi

        # Login page didn't appear - the click in STEP 2 may have hit a stale
        # WebView element. Retry STEP 2 with a fresh dump.
        log "  login not found, retrying checkin button..."
        invalidate_dump
        if click_text "$T_CHECKOUT"; then
            sleep "$TO_PAGE"; invalidate_dump
        elif click_text "$T_CHECKIN"; then
            sleep "$TO_PAGE"; invalidate_dump
        fi
        if ! wait_for_any "$T_GET_CODE" "$T_SMS_LOGIN" "$TO_LOGIN"; then fail "login page"; fi
    fi

    log "STEP 4: input phone (custom number pad)"
    dump_ui 2>/dev/null
    if ! grep -q "$T_GET_CODE" "$UI_DUMP" 2>/dev/null; then
        log "  clicking sms login to activate input mode"
        tap_screen_button 540 1401 "$T_GET_CODE" || fail "sms login"
    fi
    sleep 1

    log "STEP 5: input phone digits"
    # Fixed number pad coordinates (3x4 grid, measured from UI dump)
    # 1:(186,1791) 2:(540,1791) 3:(894,1791)
    # 4:(186,1936) 5:(540,1936) 6:(894,1936)
    # 7:(186,2080) 8:(540,2080) 9:(894,2080)
    #             0:(540,2226)
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
        log "  digit $d"
        sleep 0.5
    done
    invalidate_dump
    sleep 1

    log "STEP 5.5: record pushplus baseline (BEFORE clicking get code)"
    pp_pre_key=$(get_pp_access_key)
    if [ -n "$pp_pre_key" ]; then
        echo '{"current":1,"pageSize":3}' > "$PP_LIST_BODY"
        curl -s --max-time 10 -X POST "$PP_API_BASE/api/open/message/list" \
            -H 'Content-Type: application/json' \
            -H "access-key: $pp_pre_key" \
            -d @"$PP_LIST_BODY" 2>/dev/null | grep -o '"shortCode":"[^"]*"' | head -1 | sed 's/"shortCode":"//;s/"//' > /sdcard/pp_baseline.txt
        log "  baseline: $(cat /sdcard/pp_baseline.txt 2>/dev/null)"
    else
        log "  WARNING: no access key for baseline"
        echo "" > /sdcard/pp_baseline.txt
    fi

    log "STEP 6: request code"
    # The SMS arriving via pushplus is the only success signal we need,
    # so we blind-tap the stable coord instead of dump-hunting the
    # button: login-page animations break dumps and each retry costs
    # ~30s. If the tap missed, STEP 7 times out and the fallback coord
    # gets a second chance.
    invalidate_dump
    input tap 870 1303
    log "  get-code blind-tapped (870,1303); success signal = pushplus SMS (STEP 7)"

    log "STEP 7: get code via pushplus"
    code=$(get_code)
    if [ -z "$code" ]; then
        log "  no SMS in first window, tap fallback coord and wait once more"
        input tap 870 1207
        code=$(get_code)
        [ -z "$code" ] && fail "no code after fallback tap"
    fi
    log "  got code: $code"

    log "STEP 8: input code"
    # Sanitize: extract only digits
    code=$(echo "$code" | grep -oE '[0-9]{4,8}' | head -1)
    log "  code: $code"

    # Blind-tap the code input row (stable coord, same row as the
    # EditText seen in dumps: 424..496,1306). No dump verification here:
    # after requesting a code the page runs a 59s countdown and dumps
    # stay broken for its whole duration (2026-09-16 morning: verify
    # polls delayed submit by a minute). Outcome is judged by the
    # checkin success popup in STEP 10; a mis-tap fails there and the
    # flow restarts, which is still faster than dump-waiting.
    input tap 496 1306
    sleep 0.5
    input text "$code"
    log "  input text: $code (blind)"
    input keyevent 4
    sleep 1

    log "STEP 9: submit"
    # Blind-tap submit: dump-free, same reasoning as STEP 8. The
    # trusted-auth success popup in STEP 10 is the verdict.
    input tap 540 1536
    log "  blind-tapped submit (540,1536)"
    sleep 1

    log "STEP 10: trusted auth"
    handle_trusted

    log "STEP 11: check result"
    dump_ui; shot "result"
    if text_exists "$T_CODE_EXPIRED"; then fail "code expired"; fi
    if checkin_success_exists; then
        log "success"; log "====== checkin success ======"; exit 0
    fi
    if ! text_exists "$T_SMS_LOGIN"; then
        log "success"; log "====== checkin success ======"; exit 0
    fi

    # No success detected after trusted auth - restart the whole flow
    if ! restart_flow "no success popup after trusted auth"; then
        log "====== uncertain (max retries reached) ======"; exit 0
    fi
}

main "$@"
