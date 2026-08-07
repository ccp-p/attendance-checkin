#!/data/data/com.termux/files/usr/bin/sh
# status.sh - One-shot health check for the checkin system
# Run: sh ~/status.sh
# Shows: crond status, Shizuku status, crontab, last log entries

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
LOG=~/checkin_cron.log

echo "========== CHECKIN STATUS =========="
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 1. crond alive?
if /system/bin/pgrep -x crond > /dev/null 2>&1; then
    echo "[OK] crond running (pid $(/system/bin/pgrep -x crond))"
else
    echo "[FAIL] crond NOT running! Fix: sh ~/start-cron.sh"
fi

# 2. Shizuku alive?
SHIZUKU=$(echo 'echo SHIZUKU_OK' | timeout -s KILL 8 sh ~/rish 2>/dev/null)
if echo "$SHIZUKU" | grep -q SHIZUKU_OK; then
    echo "[OK] Shizuku running (rish works)"
else
    echo "[FAIL] Shizuku NOT responding! Fix: sh ~/start-shizuku.sh"
fi

# 3. adbd port
WIFI_ADB=$(getprop service.adb.tcp.port 2>/dev/null)
if [ -n "$WIFI_ADB" ]; then
    echo "[OK] adbd port: $WIFI_ADB"
else
    echo "[WARN] service.adb.tcp.port not set (port scan fallback after reboot)"
fi

# 4. Scripts exist?
echo ""
echo "--- Files ---"
for f in ~/run_checkin.sh ~/start-shizuku.sh ~/start-cron.sh ~/heartbeat.sh ~/scan_adbd_port.sh ~/rish ~/rish_shizuku.dex /sdcard/checkin/checkin.sh; do
    if [ -f "$f" ]; then
        echo "[OK] $f"
    else
        echo "[MISS] $f"
    fi
done

# 5. Crontab
echo ""
echo "--- Crontab ---"
/data/data/com.termux/files/usr/bin/crontab -l 2>&1

# 6. Last heartbeats
echo ""
echo "--- Last heartbeats (should be within 20 min) ---"
grep "crond-alive" "$LOG" 2>/dev/null | tail -3

# 7. Last 10 log lines
echo ""
echo "--- Last 10 log lines ---"
tail -10 "$LOG" 2>/dev/null || echo "(no log file)"
echo ""
echo "========== END STATUS =========="
