#!/data/data/com.termux/files/usr/bin/sh
# start-shizuku.sh - Auto-start Shizuku server via local adb
# Discovers adbd port via getprop or port scan, connects, starts Shizuku.
# Called by run_checkin.sh (before rish) and start-cron.sh (at boot).
#
# Port discovery (3 strategies, tried in order):
#   1. getprop service.adb.tcp.port  (set by "adb tcpip 5555", survives OOM kill)
#   2. Try port 5555 directly        (common default)
#   3. Port scan 32768-60999         (finds wireless debugging's random port after reboot)

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
ADB=/data/data/com.termux/files/usr/bin/adb
LOG=~/checkin_cron.log

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

try_connect() {
    port=$1
    $ADB connect 127.0.0.1:$port >> "$LOG" 2>&1
    sleep 1
    ADB_OK=$($ADB -s 127.0.0.1:$port shell echo ADB_OK 2>/dev/null)
    if [ "$ADB_OK" = "ADB_OK" ]; then
        return 0
    fi
    $ADB disconnect 127.0.0.1:$port >> "$LOG" 2>&1
    return 1
}

log "===== start-shizuku.sh begin ====="

# --- Step 1: Try getprop service.adb.tcp.port ---
PORT=$(getprop service.adb.tcp.port 2>/dev/null)
if [ -n "$PORT" ]; then
    log "getprop service.adb.tcp.port = $PORT"
    if try_connect "$PORT"; then
        log "adb connected via getprop port $PORT"
    else
        log "getprop port $PORT failed, trying scan..."
        PORT=""
    fi
fi

# --- Step 2: Try port 5555 directly ---
if [ -z "$PORT" ]; then
    log "trying port 5555 directly..."
    if try_connect 5555; then
        PORT=5555
        log "adb connected via port 5555"
    fi
fi

# --- Step 3: Port scan (finds wireless debugging's random port) ---
if [ -z "$PORT" ]; then
    log "port 5555 failed, running port scan (32768-60999)..."
    PORT=$(sh ~/scan_adbd_port.sh 2>/dev/null)
    if [ -z "$PORT" ]; then
        log "ERROR: Port scan found no adbd. Wireless debugging may be off."
        log "===== start-shizuku.sh FAILED ====="
        exit 1
    fi
    log "port scan found adbd on port $PORT"
fi

# --- Step 4: Check if Shizuku is already running ---
if $ADB -s 127.0.0.1:$PORT shell "ps -A | grep -q shizuku_server" 2>/dev/null; then
    log "shizuku_server already running, skipping start"
    log "===== start-shizuku.sh SUCCESS (already running) ====="
    exit 0
fi
log "shizuku_server not running, starting..."

# --- Step 5: Get Shizuku apk path, derive libshizuku.so path ---
APK_PATH=$($ADB -s 127.0.0.1:$PORT shell pm path moe.shizuku.privileged.api 2>/dev/null | head -1 | sed 's/package://')
if [ -z "$APK_PATH" ]; then
    log "ERROR: Cannot find Shizuku apk path"
    log "===== start-shizuku.sh FAILED ====="
    exit 1
fi
APK_DIR=$(dirname "$APK_PATH")
LIBSO="$APK_DIR/lib/arm64/libshizuku.so"
log "libshizuku.so: $LIBSO"

# --- Step 6: Start Shizuku server ---
$ADB -s 127.0.0.1:$PORT shell "$LIBSO" >> "$LOG" 2>&1
RC=$?
log "libshizuku.so exit code=$RC"

# --- Step 7: Wait and verify via rish ---
sleep 2
RISH_OUT=$(echo 'echo SHIZUKU_OK' | timeout -s KILL 10 sh ~/rish 2>/dev/null)
if echo "$RISH_OUT" | grep -q SHIZUKU_OK; then
    log "Shizuku verified via rish"
    log "===== start-shizuku.sh SUCCESS ====="
    exit 0
else
    log "WARNING: rish verification failed, server may still be initializing"
    log "===== start-shizuku.sh DONE (unverified) ====="
    exit 0
fi
