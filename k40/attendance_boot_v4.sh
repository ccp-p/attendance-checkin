#!/system/bin/sh
# fallback only: init service (checkin_watchdog module) auto-starts the
# watchdog at boot with auto-restart on exit. This script covers the case
# where the module failed to load.
sleep 30
if ! pgrep -f service.d/checkin_watchdog.sh > /dev/null 2>&1; then
    setsid /data/adb/service.d/checkin_watchdog.sh < /dev/null > /dev/null 2>&1 &
fi
