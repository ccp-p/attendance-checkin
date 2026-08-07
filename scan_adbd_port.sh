#!/data/data/com.termux/files/usr/bin/sh
# scan_adbd_port.sh - Fast parallel port scanner to find adbd on localhost
# Used as fallback when getprop service.adb.tcp.port is empty (after reboot)
# Scans the ephemeral port range (32768-60999) using nc with high parallelism
#
# Toybox xargs passes args as extra args to the command, not as $0/$1 to sh -c.
# So we use a wrapper script _portcheck.sh that takes the port as $1.

export HOME=/data/data/com.termux/files/home
export TMPDIR=/data/data/com.termux/files/usr/tmp
ADB=/data/data/com.termux/files/usr/bin/adb
LOG=~/checkin_cron.log
HOME_DIR=/data/data/com.termux/files/home

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

# Create the port-check wrapper script
echo '#!/system/bin/sh' > "$HOME_DIR/_portcheck.sh"
echo '/system/bin/nc -z -w1 127.0.0.1 "$1" 2>/dev/null && echo "$1"' >> "$HOME_DIR/_portcheck.sh"
chmod 755 "$HOME_DIR/_portcheck.sh"

log "scanning ports 32768-60999 for adbd..."

# Scan ephemeral port range, 200 parallel workers
# Each port is passed as arg to _portcheck.sh which prints it if open
FOUND=$(seq 32768 60999 | xargs -P 200 -n1 sh "$HOME_DIR/_portcheck.sh" 2>/dev/null | head -10)

if [ -z "$FOUND" ]; then
    log "no open ports found in range 32768-60999"
    exit 1
fi

log "open ports found: $(echo $FOUND | tr '\n' ' ')"

# Try each open port with adb connect to find the real adbd
for port in $FOUND; do
    $ADB connect 127.0.0.1:$port >/dev/null 2>&1
    sleep 0.3
    if $ADB -s 127.0.0.1:$port shell echo ADB_OK 2>/dev/null | grep -q ADB_OK; then
        echo "$port"
        exit 0
    fi
    $ADB disconnect 127.0.0.1:$port >/dev/null 2>&1
done

log "open ports found but none responded as adbd"
exit 1
