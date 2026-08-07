# .profile - Auto-recover crond + Shizuku when Termux is reopened
# Termux's login script (files/usr/bin/login) runs: exec $SHELL -l
# For bash login shell, .bash_profile > .bash_login > .profile is sourced.
# For dash login shell, .profile is sourced.
# Using .profile covers both cases.

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
LOG=~/checkin_cron.log

# Auto-start crond if not running
if ! /system/bin/pgrep -x crond > /dev/null 2>&1; then
    rm -f /data/data/com.termux/files/usr/var/run/crond.pid 2>/dev/null
    termux-wake-lock 2>/dev/null
    nohup /data/data/com.termux/files/usr/bin/crond >> "$LOG" 2>&1 &
    sleep 1
    if /system/bin/pgrep -x crond > /dev/null 2>&1; then
        echo "[checkin] crond auto-started (pid $(/system/bin/pgrep -x crond))"
    else
        echo "[checkin] WARNING: crond failed to start"
    fi
fi

# Auto-start Shizuku if not responding (async, non-blocking)
if ! echo 'echo OK' | timeout -s KILL 5 sh ~/rish 2>/dev/null | grep -q OK; then
    echo "[checkin] Shizuku not responding, auto-starting..."
    sh ~/start-shizuku.sh >> "$LOG" 2>&1 &
fi
