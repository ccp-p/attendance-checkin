#!/data/data/com.termux/files/usr/bin/sh
# Termux:Boot script - starts crond with wakelock on boot
LOG=~/checkin_cron.log
TS=$(date "+%Y-%m-%d %H:%M:%S")

echo "[$TS] ===== TERMUX:BOOT =====" >> "$LOG"
echo "[$TS] acquiring wake lock" >> "$LOG"
termux-wake-lock

echo "[$TS] starting crond" >> "$LOG"
nohup crond >> "$LOG" 2>&1 &

sleep 1
if pgrep -x crond > /dev/null 2>&1; then
    echo "[$TS] crond started, pid=$(pgrep -x crond)" >> "$LOG"
else
    echo "[$TS] ERROR: crond failed to start!" >> "$LOG"
fi
echo "[$TS] ===== BOOT DONE =====" >> "$LOG"