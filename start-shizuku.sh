#!/data/data/com.termux/files/usr/bin/sh
# start-shizuku.sh - Auto-start Shizuku server via local adb
# Ensures shizuku_server is running AND rish can connect to it.
# If server is running but rish can't connect (broken binder), kills and restarts.

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
ADB=/data/data/com.termux/files/usr/bin/adb
LOG=~/checkin_cron.log

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

# Check if rish works (binder connection alive)
rish_alive() {
    echo 'echo SHIZUKU_OK' | timeout -s KILL 10 sh ~/rish 2>/dev/null | grep -q SHIZUKU_OK
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

# --- Fast path: rish already works, nothing to do ---
if rish_alive; then
    log "rish OK, Shizuku fully operational"
    log "===== start-shizuku.sh SUCCESS (already running) ====="
    exit 0
fi
log "rish not responding, need to start/restart Shizuku..."

# --- Step 1: Find adbd port ---
PORT=$(getprop service.adb.tcp.port 2>/dev/null)
if [ -n "$PORT" ]; then
    log "getprop service.adb.tcp.port = $PORT"
    if ! try_connect "$PORT"; then
        log "getprop port $PORT failed, trying scan..."
        PORT=""
    fi
fi

if [ -z "$PORT" ]; then
    log "trying port 5555 directly..."
    if try_connect 5555; then
        PORT=5555
    fi
fi

if [ -z "$PORT" ]; then
    log "port 5555 failed, running port scan (32768-60999)..."
    PORT=$(sh ~/scan_adbd_port.sh 2>/dev/null)
    if [ -z "$PORT" ]; then
        log "ERROR: Port scan found no adbd. Wireless debugging may be off."
        log "===== start-shizuku.sh FAILED ====="
        exit 1
    fi
fi
log "adb connected to 127.0.0.1:$PORT"

# --- Step 2: If shizuku_server is running but rish fails, kill and restart ---
SERVER_PID=$($ADB -s 127.0.0.1:$PORT shell "ps -A | grep shizuku_server | head -1 | tr -s ' ' | cut -d' ' -f2" 2>/dev/null)
if [ -n "$SERVER_PID" ]; then
    log "shizuku_server running (pid $SERVER_PID) but rish fails, killing for restart..."
    $ADB -s 127.0.0.1:$PORT shell "kill $SERVER_PID" 2>/dev/null
    sleep 2
fi

# --- Step 3: Get Shizuku apk path, derive libshizuku.so path ---
APK_PATH=$($ADB -s 127.0.0.1:$PORT shell pm path moe.shizuku.privileged.api 2>/dev/null | head -1 | sed 's/package://')
if [ -z "$APK_PATH" ]; then
    log "ERROR: Cannot find Shizuku apk path"
    log "===== start-shizuku.sh FAILED ====="
    exit 1
fi
APK_DIR=$(dirname "$APK_PATH")
LIBSO="$APK_DIR/lib/arm64/libshizuku.so"
log "starting shizuku_server via $LIBSO"

# --- Step 4: Start Shizuku server ---
$ADB -s 127.0.0.1:$PORT shell "$LIBSO" >> "$LOG" 2>&1
RC=$?
log "libshizuku.so exit code=$RC"

# --- Step 5: Wait and verify via rish ---
# Binder connection needs time to establish after server start.
# Retry rish every 3 seconds for up to 30 seconds.
log "waiting for rish binder connection..."
for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    if rish_alive; then
        log "Shizuku verified via rish (attempt $i)"
        log "===== start-shizuku.sh SUCCESS ====="
        exit 0
    fi
    log "rish attempt $i failed, retrying..."
done
log "ERROR: rish verification failed after 10 retries (30s)"
log "===== start-shizuku.sh FAILED ====="
exit 1
