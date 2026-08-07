# .bashrc - Auto-recover crond + Shizuku when Termux is reopened
# Termux gets killed by Android OOM killer; crond dies with it.
# This runs every time you open the Termux app, ensuring crond is alive.

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
LOG=~/checkin_cron.log

# Auto-start crond if not running (check actual process, not pid file)
if ! pgrep -x crond > /dev/null 2>&1; then
    rm -f /data/data/com.termux/files/usr/var/run/crond.pid 2>/dev/null
    termux-wake-lock 2>/dev/null
    nohup /data/data/com.termux/files/usr/bin/crond >> "$LOG" 2>&1 &
    sleep 1
    if pgrep -x crond > /dev/null 2>&1; then
        echo "[checkin] crond auto-started (pid $(pgrep -x crond))"
    else
        echo "[checkin] WARNING: crond failed to start!"
    fi
fi

# Auto-start Shizuku if not responding (async, non-blocking)
if ! echo 'echo OK' | timeout -s KILL 5 sh ~/rish 2>/dev/null | grep -q OK; then
    echo "[checkin] Shizuku not responding, auto-starting..."
    sh ~/start-shizuku.sh >> "$LOG" 2>&1 &
fi
