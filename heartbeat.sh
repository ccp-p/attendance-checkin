#!/data/data/com.termux/files/usr/bin/sh
LOG=~/checkin_cron.log
echo "$(date '+%Y-%m-%d %H:%M:%S') crond-alive"

# Auto-truncate log: if >1MB, keep last 200 lines
SIZE=$(wc -c < "$LOG" 2>/dev/null || echo 0)
if [ "$SIZE" -gt 1048576 ]; then
    tail -200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
    echo "$(date '+%Y-%m-%d %H:%M:%S') log auto-truncated (was ${SIZE} bytes)" 
fi
