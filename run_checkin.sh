#!/data/data/com.termux/files/usr/bin/sh
# Run checkin via rish (Shizuku shell)
# Enhanced with Shizuku auto-recovery + timestamped logging

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
LOG=~/checkin_cron.log

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

rish_alive() {
    echo 'echo SHIZUKU_OK' | timeout -s KILL 10 sh ~/rish 2>/dev/null | grep -q SHIZUKU_OK
}

log "===== CRON TRIGGERED ====="

# Check if rish exists
if [ ! -f ~/rish ]; then
    log "ERROR: ~/rish not found!"
    log "===== CRON ABORTED ====="
    exit 1
fi

# Check if Shizuku is alive, recover if not
log "probing Shizuku..."
if rish_alive; then
    log "Shizuku is running"
else
    log "Shizuku not responding, auto-starting..."
    sh ~/start-shizuku.sh >> "$LOG" 2>&1

    if rish_alive; then
        log "Shizuku recovered successfully"
    else
        log "ERROR: Shizuku recovery failed! Aborting."
        log "===== CRON ABORTED (no Shizuku) ====="
        exit 1
    fi
fi

# Check if checkin.sh exists
if [ ! -f /sdcard/checkin/checkin.sh ]; then
    log "ERROR: /sdcard/checkin/checkin.sh not found!"
    log "===== CRON ABORTED ====="
    exit 1
fi

log "executing checkin.sh via rish"
echo 'sh /sdcard/checkin/checkin.sh' | sh ~/rish
RC=$?

log "checkin.sh exited with code=$RC"
log "===== CRON FINISHED ====="
