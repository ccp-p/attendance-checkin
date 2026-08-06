#!/system/bin/sh
# Standalone test: input verification code into EditText.
# Run this when the phone is on the SMS login page with the code field visible.
# Usage: sh /sdcard/test_input_code.sh 123456

UI_DUMP="/sdcard/ui_dump.xml"
CODE="${1:-888888}"

echo "=== STEP 1: Dump UI ==="
uiautomator dump "$UI_DUMP" 2>/dev/null
if [ ! -f "$UI_DUMP" ]; then echo "FAILED: dump failed"; exit 1; fi

echo "=== STEP 2: Find EditText ==="
et=$(cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep "EditText" | head -1)
echo "EditText line: $et"

if [ -n "$et" ]; then
    eb=$(echo "$et" | grep -o 'bounds="\[[0-9,]*\]\[[0-9,]*\]"' | head -1)
    echo "bounds: $eb"
    if [ -n "$eb" ]; then
        en=$(echo "$eb" | sed 's/[^0-9,]//g')
        ex1=$(echo "$en" | cut -d, -f1); ey1=$(echo "$en" | cut -d, -f2)
        ex2=$(echo "$en" | cut -d, -f3); ey2=$(echo "$en" | cut -d, -f4)
        cx=$(( (ex1 + ex2) / 2 )); cy=$(( (ey1 + ey2) / 2 ))
        echo "EditText center: $cx,$cy"
        echo "=== STEP 3: Tap EditText ==="
        input tap "$cx" "$cy"
        sleep 1
    else
        echo "No bounds found, using fallback 496,1306"
        input tap 496 1306; sleep 1
    fi
else
    echo "EditText not found, using fallback 496,1306"
    input tap 496 1306; sleep 1
fi

echo "=== STEP 4: Input text '$CODE' ==="
input text "$CODE"
sleep 1

echo "=== STEP 5: Verify ==="
uiautomator dump "$UI_DUMP" 2>/dev/null
if grep -q "$CODE" "$UI_DUMP" 2>/dev/null; then
    echo "SUCCESS: code '$CODE' found in UI dump"
else
    echo "WARNING: code not found in dump, checking EditText text..."
    et2=$(cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep "EditText" | head -1)
    echo "EditText after: $et2"
fi

echo "=== STEP 6: Show current screen text ==="
cat "$UI_DUMP" | sed 's/<node/\n<node/g' | grep -o 'text="[^"]*"' | sed 's/text="//;s/"//' | grep -v '^$' | head -20
echo "=== DONE ==="
