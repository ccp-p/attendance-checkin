# .bashrc - Auto-recover crond + Shizuku when Termux is reopened
# Termux gets killed by Android OOM killer; crond dies with it.
# This runs every time you open the Termux app, ensuring crond is alive.

# Only run in interactive shells (not when scripts source this)
case $- in
    *i*) ;;
    *) return 2>/dev/null || exit 0 ;;
esac

# Only run once per session
[ -n "$_BASHRC_CHECKIN_DONE" ] && return 2>/dev/null || _BASHRC_CHECKIN_DONE=1

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
LOG=~/checkin_cron.log

# Auto-start crond if not running
if ! pgrep -x crond > /dev/null 2>&1; then
    termux-wake-lock 2>/dev/null
    nohup /data/data/com.termux/files/usr/bin/crond >> "$LOG" 2>&1 &
    # Retry check for up to 3 seconds (crond may need a moment to fork)
    for i in 1 2 3 4 5 6; do
        sleep 0.5
        if pgrep -x crond > /dev/null 2>&1; then
            echo "[checkin] crond auto-started (pid $(pgrep -x crond))"
            break
        fi
        [ $i -eq 6 ] && echo "[checkin] WARNING: crond failed to start!"
    done
fi

# Auto-start Shizuku if not responding (async, non-blocking)
if ! echo 'echo OK' | timeout -s KILL 5 sh ~/rish 2>/dev/null | grep -q OK; then
    echo "[checkin] Shizuku not responding, auto-starting..."
    sh ~/start-shizuku.sh >> "$LOG" 2>&1 &
fi
