#!/data/data/com.termux/files/usr/bin/sh
# Run checkin via rish (Shizuku shell)
# Enhanced with Shizuku auto-recovery + timestamped logging

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
LOG=~/checkin_cron.log
TS=$(date "+%Y-%m-%d %H:%M:%S")

echo "[$TS] ===== CRON TRIGGERED =====" >> "$LOG"

# Check if rish exists
if [ ! -f ~/rish ]; then
    echo "[$TS] ERROR: ~/rish not found!" >> "$LOG"
    exit 1
fi

# Check if Shizuku is alive (quick probe via rish with timeout)
echo "[$TS] probing Shizuku..." >> "$LOG"
if echo 'echo SHIZUKU_OK' | timeout -s KILL 8 sh ~/rish 2>/dev/null | grep -q SHIZUKU_OK; then
    echo "[$TS] Shizuku is running" >> "$LOG"
else
    echo "[$TS] Shizuku not responding, auto-starting..." >> "$LOG"
    sh ~/start-shizuku.sh >> "$LOG" 2>&1
    sleep 2
    if echo 'echo SHIZUKU_OK' | timeout -s KILL 8 sh ~/rish 2>/dev/null | grep -q SHIZUKU_OK; then
        echo "[$TS] Shizuku recovered successfully" >> "$LOG"
    else
        echo "[$TS] ERROR: Shizuku recovery failed!" >> "$LOG"
        echo "[$TS] ===== CRON ABORTED (no Shizuku) =====" >> "$LOG"
        exit 1
    fi
fi

# Check if checkin.sh exists
if [ ! -f /sdcard/checkin/checkin.sh ]; then
    echo "[$TS] ERROR: /sdcard/checkin/checkin.sh not found!" >> "$LOG"
    echo "[$TS] ===== CRON ABORTED =====" >> "$LOG"
    exit 1
fi

echo "[$TS] executing checkin.sh via rish" >> "$LOG"
echo 'sh /sdcard/checkin/checkin.sh' | sh ~/rish
RC=$?

TS2=$(date "+%Y-%m-%d %H:%M:%S")
echo "[$TS2] checkin.sh exited with code=$RC" >> "$LOG"
echo "[$TS2] ===== CRON FINISHED =====" >> "$LOG"
