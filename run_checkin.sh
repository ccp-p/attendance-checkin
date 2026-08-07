#!/data/data/com.termux/files/usr/bin/sh
# Run checkin via rish (Shizuku shell)
# Enhanced with timestamped logging for production reliability

LOG=~/checkin_cron.log
TS=$(date "+%Y-%m-%d %H:%M:%S")

echo "[$TS] ===== CRON TRIGGERED =====" >> "$LOG"
echo "[$TS] run_checkin.sh started, pid=$$" >> "$LOG"

# Check if rish exists
if [ ! -f ~/rish ]; then
    echo "[$TS] ERROR: ~/rish not found!" >> "$LOG"
    exit 1
fi

# Check if checkin.sh exists
if [ ! -f /sdcard/checkin/checkin.sh ]; then
    echo "[$TS] ERROR: /sdcard/checkin/checkin.sh not found!" >> "$LOG"
    exit 1
fi

# Run the checkin script via rish (shell user via Shizuku)
echo "[$TS] executing: sh /sdcard/checkin/checkin.sh" >> "$LOG"
echo 'sh /sdcard/checkin/checkin.sh' | sh ~/rish
RC=$?

TS2=$(date "+%Y-%m-%d %H:%M:%S")
echo "[$TS2] checkin.sh exited with code=$RC" >> "$LOG"
echo "[$TS2] ===== CRON FINISHED =====" >> "$LOG"