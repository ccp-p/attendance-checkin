#!/data/data/com.termux/files/usr/bin/sh
# start-shizuku.sh - Auto-start Shizuku server via local adb
# Discovers adbd port via getprop, connects, starts Shizuku.
# Called by run_checkin.sh (before rish) and start-cron.sh (at boot).
#
# Why this exists:
#   rish requires shizuku_server to be running. After OOM kill,
#   shizuku_server is dead and rish fails. This script restarts it using
#   Termux's local adb (connected to the phone's own adbd on port 5555).
#
# Port discovery:
#   1. getprop service.adb.tcp.port  (set by "adb tcpip 5555", readable by app user)
#   2. Fallback: try port 5555 directly
#
# After phone reboot:
#   service.adb.tcp.port may be empty and port 5555 may not be listening.
#   Connect phone to PC via USB and run: adb tcpip 5555
#   Then this script works for subsequent OOM-kill recoveries.

ADB=/data/data/com.termux/files/usr/bin/adb
LOG=~/checkin_cron.log

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

log "===== start-shizuku.sh begin ====="

# --- Step 1: Discover adbd port ---
PORT=$(getprop service.adb.tcp.port 2>/dev/null)
if [ -n "$PORT" ]; then
    log "getprop service.adb.tcp.port = $PORT"
else
    log "service.adb.tcp.port not set, trying default port 5555"
    PORT=5555
fi

# --- Step 2: Connect adb to local adbd ---
$ADB connect 127.0.0.1:$PORT >> "$LOG" 2>&1
sleep 1

ADB_OK=$($ADB -s 127.0.0.1:$PORT shell echo ADB_OK 2>/dev/null)
if [ "$ADB_OK" != "ADB_OK" ]; then
    log "ERROR: adb shell test failed on 127.0.0.1:$PORT"
    log "  If phone was rebooted, connect via USB and run: adb tcpip 5555"
    log "===== start-shizuku.sh FAILED ====="
    exit 1
fi
log "adb connected to 127.0.0.1:$PORT"

# --- Step 3: Check if Shizuku is already running ---
if $ADB -s 127.0.0.1:$PORT shell "ps -A | grep -q shizuku_server" 2>/dev/null; then
    log "shizuku_server already running, skipping start"
    log "===== start-shizuku.sh SUCCESS (already running) ====="
    exit 0
fi
log "shizuku_server not running, starting..."

# --- Step 4: Get Shizuku apk path, derive libshizuku.so path ---
APK_PATH=$($ADB -s 127.0.0.1:$PORT shell pm path moe.shizuku.privileged.api 2>/dev/null | head -1 | sed 's/package://')
if [ -z "$APK_PATH" ]; then
    log "ERROR: Cannot find Shizuku apk path"
    log "===== start-shizuku.sh FAILED ====="
    exit 1
fi
APK_DIR=$(dirname "$APK_PATH")
LIBSO="$APK_DIR/lib/arm64/libshizuku.so"
log "libshizuku.so: $LIBSO"

# --- Step 5: Start Shizuku server ---
$ADB -s 127.0.0.1:$PORT shell "$LIBSO" >> "$LOG" 2>&1
RC=$?
log "libshizuku.so exit code=$RC"

# --- Step 6: Wait and verify via rish ---
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
