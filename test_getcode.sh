#!/system/bin/sh
# Standalone test: poll pushplus for new verification code.
# Usage: sh /sdcard/test_getcode.sh
# Run AFTER clicking "获取验证码" on the phone.

PP_TOKEN="821c4bffa77242268d9664c3e3a24cce"
PP_SECRET_KEY="ogIU753RWNhMVOdUMn-3gHm4LvRI"
PP_API_BASE="https://www.pushplus.plus"
PP_LIST_BODY="/sdcard/pp_list.json"

echo '{"current":1,"pageSize":5}' > "$PP_LIST_BODY"

echo "=== STEP 1: Get AccessKey ==="
resp=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/common/openApi/getAccessKey" \
    -H 'Content-Type: application/json' \
    -d "{\"token\":\"$PP_TOKEN\",\"secretKey\":\"$PP_SECRET_KEY\"}")
echo "$resp"
access_key=$(echo "$resp" | grep -o '"accessKey":"[^"]*"' | head -1 | sed 's/"accessKey":"//;s/"//')
if [ -z "$access_key" ]; then echo "FAILED: no access key"; exit 1; fi
echo "OK: access_key=$access_key"

echo "=== STEP 2: Record baseline shortCode ==="
latest_sc=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/open/message/list" \
    -H 'Content-Type: application/json' \
    -H "access-key: $access_key" \
    -d @"$PP_LIST_BODY" 2>/dev/null | grep -o '"shortCode":"[^"]*"' | head -1 | sed 's/"shortCode":"//;s/"//')
echo "baseline=$latest_sc"

echo "=== STEP 3: Polling for new code (max 150s) ==="
dl=$(( $(date +%s) + 150 ))
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if [ $(date +%s) -ge $dl ]; then echo "TIMEOUT"; exit 1; fi

    echo "--- attempt $i ---"
    resp=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/open/message/list" \
        -H 'Content-Type: application/json' \
        -H "access-key: $access_key" \
        -d @"$PP_LIST_BODY" 2>/dev/null)
    if [ -z "$resp" ]; then echo "empty response"; sleep 8; continue; fi

    if echo "$resp" | grep -q '"code":40'; then
        echo "access key expired, refreshing..."
        resp=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/common/openApi/getAccessKey" \
            -H 'Content-Type: application/json' \
            -d "{\"token\":\"$PP_TOKEN\",\"secretKey\":\"$PP_SECRET_KEY\"}")
        access_key=$(echo "$resp" | grep -o '"accessKey":"[^"]*"' | head -1 | sed 's/"accessKey":"//;s/"//')
        continue
    fi

    # Check if newest shortCode changed (new message arrived)
    new_sc=$(echo "$resp" | grep -o '"shortCode":"[^"]*"' | head -1 | sed 's/"shortCode":"//;s/"//')
    echo "newest_sc=$new_sc"
    if [ "$new_sc" = "$latest_sc" ]; then
        echo "no new message yet"
        sleep 8
        continue
    fi

    echo "NEW MESSAGE DETECTED! Extracting code..."
    # Extract code from titles (newest first)
    echo "$resp" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"$//' > /sdcard/pp_titles.txt
    while IFS= read -r ti; do
        echo "  title=[$ti] len=${#ti}"
        # Skip short titles
        if [ ${#ti} -le 10 ]; then echo "  -> skip (too short)"; continue; fi
        # Skip pure-number titles (sender IDs like 10658104506)
        case "$ti" in *[!0-9]*) ;; *) echo "  -> skip (pure number)"; continue;; esac
        # Extract 6-digit code
        code=$(echo "$ti" | grep -oE '[0-9]{6}' | head -1)
        if [ -n "$code" ]; then
            echo ""
            echo "========== FOUND CODE: $code =========="
            echo "  from: $ti"
            rm -f /sdcard/pp_titles.txt
            exit 0
        fi
    done < /sdcard/pp_titles.txt
    rm -f /sdcard/pp_titles.txt

    echo "new message but no code found, keep polling..."
    sleep 8
done
echo "TIMEOUT: no code received"
exit 1
