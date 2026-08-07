#!/data/data/com.termux/files/usr/bin/sh
# Termux:Boot script - starts crond + Shizuku with wakelock on boot
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

# Start Shizuku after a short delay (let adbd initialize)
echo "[$TS] scheduling Shizuku auto-start in 10s..." >> "$LOG"
(sleep 10 && sh ~/start-shizuku.sh >> "$LOG" 2>&1) &

echo "[$TS] ===== BOOT DONE =====" >> "$LOG"
