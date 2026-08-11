#!/system/bin/sh
# Attendance checkin - phone-side, triggered by cron via rish
# Uses pushplus WeChat forwarding for SMS code retrieval

APP_PACKAGE="com.cmri.ercs.yqx"
PHONE_INPUT="2449"
DIR="/sdcard/checkin"
LOG_FILE="$DIR/checkin.log"
SHOT_DIR="$DIR/screenshots"
UI_DUMP="/sdcard/ui_dump.xml"

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
T_LOC_ERROR="位置信息获取失败"
T_CONFIRM="确认"
T_CODE_EXPIRED="短信验证码过期或不存在"
WECHAT_PKG="com.tencent.mm"

T_CONFIRM_CHECKIN="确认打卡"

TO_FIND=5
TO_PAGE=2
TO_LAUNCH=3
TO_LOGIN=12
TO_CODE=120
TO_PUSHPLUS_DELAY=8
TO_WX_LOAD=2

# UI coordinates calibrated on device (1080x2376)
COORD_CANCEL="520 1830"       # 可信认证 取消 button
COORD_TRUST_BACK="86 203"     # back button after dismissing trusted-auth popup

# pushplus polling interval (seconds between API calls)
TO_PP_POLL=5

# Temporary files for pushplus API
PP_KEY_BODY="/sdcard/pp_key.json"
PP_LIST_BODY="/sdcard/pp_list.json"
PP_RESP="/sdcard/pp_resp.json"

mkdir -p "$DIR" "$SHOT_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE" >&2; }

# Auto-rotation state saved on entry, restored on exit
AUTO_ROT=""
restore_rotation() {
    if [ -n "$AUTO_ROT" ]; then
        settings put system accelerometer_rotation "$AUTO_ROT" 2>/dev/null
        settings put system user_rotation 0 2>/dev/null
    fi
}
trap restore_rotation EXIT

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

dismiss_loc() {
    if text_exists "$T_LOC_ERROR"; then
        log "  loc popup"; click_text "$T_CONFIRM"; sleep 1; return 0
    fi
    return 1
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
            log "  pp: no new code yet"
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

        log "  pp: no new code yet"
        sleep "$TO_PP_POLL"
    done

    log "  pp: timed out"
    return 1
}

handle_trusted() {
    log "  checking trusted auth..."
    for i in 1 2 3 4 5 6; do
        if text_exists "$T_TRUSTED_AUTH" || text_exists "$T_TRUSTED_AUTH_PLATFORM"; then
            log "  trusted auth!"; shot "trusted"
            input tap $COORD_CANCEL; sleep 1
           shot "trusted_after_cancel"; sleep "$TO_PAGE"
           # click back button at top-left to dismiss residual page
           input tap $COORD_TRUST_BACK; sleep "$TO_PAGE"
           input tap $COORD_TRUST_BACK; sleep "$TO_PAGE"
           shot "trusted_after_back"; return 0
        fi
        invalidate_dump
        sleep 2
    done
    log "  no trusted auth"; return 1
}

check_trusted() {
    if text_exists "$T_TRUSTED_AUTH" || text_exists "$T_TRUSTED_AUTH_PLATFORM"; then
        log "  trusted auth popup!"; shot "trusted_popup"
       input tap $COORD_CANCEL; sleep 1
       # click back button at top-left to dismiss residual page
       input tap $COORD_TRUST_BACK; sleep "$TO_PAGE"
       input tap $COORD_TRUST_BACK; sleep "$TO_PAGE"
       shot "trusted_after_back"; return 0
    fi
    return 1
}

print_screen() {
    dump_ui || return 1
    cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep -o 'text="[^"]*"' | sed 's/text="//;s/"//' | grep -v '^$' | head -20 >> "$LOG_FILE"
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

# Navigate to the attendance page regardless of current state.
goto_attendance() {
    detect_page
    case $? in
        0) log "  already on attendance page"; return 0 ;;
        1) log "  on workbench, navigating to attendance"
           click_text "$T_WORKBENCH"; sleep "$TO_PAGE"
           click_text_wait "$T_ATTENDANCE" 5 || { log "  timeout: $T_ATTENDANCE"; return 1; }
           return 0 ;;
        2) log "  unknown page, trying workbench first"
           click_text_wait "$T_WORKBENCH" 5 || { log "  timeout: $T_WORKBENCH"; return 1; }
           sleep "$TO_PAGE"
           click_text_wait "$T_ATTENDANCE" 5 || { log "  timeout: $T_ATTENDANCE"; return 1; }
           return 0 ;;
    esac
}

main() {
    log "====== checkin started ======"
    # Clear coordinate cache
    rm -f /sdcard/checkin/.cache_* 2>/dev/null
    # Save auto-rotation state, then disable it (uiautomator dump tends to turn it on)
    AUTO_ROT=$(settings get system accelerometer_rotation 2>/dev/null)
    lock_rotation

    log "STEP 0: wake screen & launch"
    # Wake up screen (cron runs while screen is off)
    input keyevent 224; sleep 1
    # Force-stop app to guarantee fresh initial state
    am force-stop "$APP_PACKAGE"; sleep 1
    input keyevent KEYCODE_HOME; sleep 1
    invalidate_dump
    # Use am start instead of monkey: monkey injects rotation events that
    # enable auto-rotation on Android 14+ (see MonkeyRotationEven#injectEvent
    # in dumpsys window RotationLockHistory)
    am start -n "$APP_PACKAGE/com.cmic.module_main.ui.activity.WelcomeActivity" 2>/dev/null
    sleep "$TO_LAUNCH"
    invalidate_dump
    check_trusted

    log "STEP 1: navigate to attendance"
    if ! goto_attendance; then
        input swipe 540 1800 540 600 500; sleep 1
        invalidate_dump
        if ! goto_attendance; then fail "attendance"; fi
    fi
    sleep "$TO_PAGE"
    invalidate_dump

    log "STEP 2: checkin/checkout"
    # Retry loop: handle location error popup, then click 签到/签退
    # Uses cached coords after first successful dump
    checkin_done=0
    for ci in 1 2 3 4 5 6; do
        # Check location error popup (needs dump)
        if text_exists "$T_LOC_ERROR"; then
            log "  loc popup"; click_text "$T_CONFIRM"; sleep 1
        fi
        # Fresh dump for checkin/checkout (WebView may still be loading)
        invalidate_dump
        if click_text "$T_CHECKIN"; then checkin_done=1; break; fi
        if click_text "$T_CHECKOUT"; then checkin_done=1; break; fi
        log "  retry checkin ($ci)"
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
    if ! wait_for_any "$T_GET_CODE" "$T_SMS_LOGIN" "$TO_LOGIN"; then fail "login page"; fi

    log "STEP 4: input phone (custom number pad)"
    dump_ui 2>/dev/null
    if ! grep -q "$T_GET_CODE" "$UI_DUMP" 2>/dev/null; then
        log "  clicking sms login to activate input mode"
        click_text "$T_SMS_LOGIN" || fail "sms login"
        wait_for_text "$T_GET_CODE" 10 || log "  get code not found"
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
    # Fresh dump - page layout may have shifted after entering phone digits
    invalidate_dump
    if ! click_text "$T_GET_CODE"; then click_xy 870 1207; fi

    # Verify button was actually clicked (countdown timer appears)
    sleep 2
    invalidate_dump
    dump_ui 2>/dev/null
    if cat "$UI_DUMP" 2>/dev/null | grep -qE '[0-9]+s'; then
        log "  code requested, countdown detected"
    else
        log "  WARNING: countdown not found, retrying click"
        # Try known coords as fallback
        input tap 870 1207
        sleep 2
        invalidate_dump
        dump_ui 2>/dev/null
        if cat "$UI_DUMP" 2>/dev/null | grep -qE '[0-9]+s'; then
            log "  code requested on retry, countdown detected"
        else
            log "  WARNING: no countdown after retry"
        fi
    fi

    log "STEP 7: get code via pushplus"
    code=$(get_code)
    if [ -z "$code" ]; then fail "no code"; fi
    log "  got code: $code"

    log "STEP 8: input code"
    # Sanitize: extract only digits
    code=$(echo "$code" | grep -oE '[0-9]{4,8}' | head -1)
    log "  code: $code"

    # Single dump: find EditText + submit button coords at once
    invalidate_dump
    dump_ui 2>/dev/null

    # Find EditText
    et=$(cat "$UI_DUMP" 2>/dev/null | sed 's/<node/\n<node/g' | grep "EditText" | head -1)
    if [ -n "$et" ]; then
        eb=$(echo "$et" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
        if [ -n "$eb" ]; then
            en=$(echo "$eb" | sed 's/\]\[/,/g; s/[^0-9,]//g')
            ex1=$(echo "$en" | cut -d, -f1); ey1=$(echo "$en" | cut -d, -f2)
            ex2=$(echo "$en" | cut -d, -f3); ey2=$(echo "$en" | cut -d, -f4)
            cx=$(( (ex1 + ex2) / 2 )); cy=$(( (ey1 + ey2) / 2 ))
            log "  tap EditText at $cx,$cy"
            input tap "$cx" "$cy"
        else
            log "  EditText no bounds, tap 496,1306"
            input tap 496 1306
        fi
    else
        log "  EditText not found, tap 496,1306"
        input tap 496 1306
    fi
    sleep 0.5

    # Type the code
    input text "$code"
    log "  input text: $code"

    # Dismiss keyboard - it covers the submit button
    log "  hiding keyboard"
    input keyevent 4
    sleep 1

    # Single dump: verify code entered + find submit button
    invalidate_dump
    dump_ui 2>/dev/null
    if grep -q "$code" "$UI_DUMP" 2>/dev/null; then
        log "  code verified in EditText"
    else
        log "  WARNING: code not in dump"
    fi

    log "STEP 9: submit"
    # Use cached dump to find submit button (no extra dump)
    submit_line=$(cat "$UI_DUMP" 2>/dev/null | sed 's/<node/\n<node/g' | grep "text=\"$T_SMS_LOGIN\"" | head -1)
    if [ -n "$submit_line" ]; then
        sb=$(echo "$submit_line" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
        if [ -n "$sb" ]; then
            sn=$(echo "$sb" | sed 's/\]\[/,/g; s/[^0-9,]//g')
            sx1=$(echo "$sn" | cut -d, -f1); sy1=$(echo "$sn" | cut -d, -f2)
            sx2=$(echo "$sn" | cut -d, -f3); sy2=$(echo "$sn" | cut -d, -f4)
            scx=$(( (sx1 + sx2) / 2 )); scy=$(( (sy1 + sy2) / 2 ))
            input tap "$scx" "$scy"
            log "  clicked submit at $scx,$scy"
        else
            input tap 540 1536
            log "  submit no bounds, tap 540,1536"
        fi
    else
        input tap 540 1536
        log "  submit not found, tap 540,1536"
    fi
    sleep 1

    log "STEP 10: trusted auth"
    handle_trusted

    log "STEP 11: check result"
    dump_ui; shot "result"
    if text_exists "$T_CODE_EXPIRED"; then fail "code expired"; fi
    if ! text_exists "$T_SMS_LOGIN"; then
        log "success"; log "====== checkin success ======"; exit 0
    fi
    log "====== uncertain ======"; exit 0
}

main "$@"
