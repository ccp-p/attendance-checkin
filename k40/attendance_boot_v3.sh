#!/system/bin/sh
# attendance checkin boot - start the root shell watchdog only.
# (JS schedule loop removed - MIUI kills it; the watchdog is the single
# trigger path and run_retry.js handles retries.)
sleep 15
nohup /data/adb/service.d/checkin_watchdog.sh > /dev/null 2>&1 &
