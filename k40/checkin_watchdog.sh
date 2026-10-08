#!/system/bin/sh
# attendance checkin watchdog - root shell loop, independent of AutoJs6.
# MIUI kills AutoJs6 background loops overnight; this shell process
# survives and re-launches the script at scheduled times via am start.
# run_retry.js has its own 3-attempt retry with 120s delay.

LOG=/sdcard/checkin/watchdog.log

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"; }

log "watchdog started, times: 07:20 17:30"

while true; do
    T=$(date '+%H:%M')
    for TARGET in 07:20 17:30; do
        if [ "$T" = "$TARGET" ]; then
            KEY="$(date '+%Y-%m-%d') $TARGET"
            if ! grep -q "fired $KEY" "$LOG" 2>/dev/null; then
                log "fired $KEY -> launching run_retry.js"
                echo "fired $KEY" >> "$LOG"
                input keyevent KEYCODE_WAKEUP
                am start -a android.intent.action.VIEW \
                    -n org.autojs.autojs6/org.autojs.autojs.external.open.RunIntentActivity \
                    -d 'file:///sdcard/脚本/attendance-checkin/run_retry.js' \
                    -t 'application/x-javascript'
                log "am start completed"
            fi
        fi
    done
    sleep 20
done
