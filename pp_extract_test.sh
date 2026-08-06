#!/system/bin/sh
# Test get_code() extraction logic with real API data

PP_API_BASE="https://www.pushplus.plus"
PP_TOKEN="821c4bffa77242268d9664c3e3a24cce"
PP_SECRET_KEY="ogIU753RWNhMVOdUMn-3gHm4LvRI"
PP_LIST_BODY="/sdcard/pp_list.json"

echo '{"current":1,"pageSize":3}' > "$PP_LIST_BODY"

# Get access key
resp=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/common/openApi/getAccessKey" \
    -H 'Content-Type: application/json' \
    -d "{\"token\":\"$PP_TOKEN\",\"secretKey\":\"$PP_SECRET_KEY\"}")
echo "=== ACCESS KEY RESP ==="
echo "$resp"
access_key=$(echo "$resp" | grep -o '"accessKey":"[^"]*"' | head -1 | sed 's/"accessKey":"//;s/"//')
echo "KEY=$access_key"
if [ -z "$access_key" ]; then echo "FAILED"; exit 1; fi

# Get baseline shortCode
latest_sc=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/open/message/list" \
    -H 'Content-Type: application/json' \
    -H "access-key: $access_key" \
    -d @"$PP_LIST_BODY" 2>/dev/null | grep -o '"shortCode":"[^"]*"' | head -1 | sed 's/"shortCode":"//;s/"//')
echo "=== BASELINE SC: $latest_sc ==="

# Now poll and extract
resp=$(curl -s --max-time 10 -X POST "$PP_API_BASE/api/open/message/list" \
    -H 'Content-Type: application/json' \
    -H "access-key: $access_key" \
    -d @"$PP_LIST_BODY" 2>/dev/null)

echo "=== TITLES ==="
echo "$resp" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"$//' > /sdcard/pp_titles.txt
cat /sdcard/pp_titles.txt

echo "=== SHORTCODES ==="
echo "$resp" | grep -o '"shortCode":"[^"]*"' | sed 's/"shortCode":"//;s/"$//' > /sdcard/pp_codes.txt
cat /sdcard/pp_codes.txt

echo "=== EXTRACTION ==="
while IFS= read -r ti && IFS= read -r sc <&3; do
    echo "title=[$ti] sc=$sc len=${#ti}"
    if [ "$sc" = "$latest_sc" ]; then echo "  -> HIT BASELINE, stop"; break; fi
    [ ${#ti} -le 10 ] && echo "  -> skip (too short)"; continue
    code=$(echo "$ti" | grep -oE '[0-9]{6}' | head -1)
    if [ -n "$code" ]; then
        echo "  -> CODE FOUND: $code"
    else
        echo "  -> no 6-digit code"
    fi
done < /sdcard/pp_titles.txt 3< /sdcard/pp_codes.txt
rm -f /sdcard/pp_titles.txt /sdcard/pp_codes.txt
echo "=== DONE ==="
