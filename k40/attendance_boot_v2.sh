#!/system/bin/sh
# AutoJS6 attendance checkin - start schedule loop on boot
sleep 15
am start -a android.intent.action.VIEW -n org.autojs.autojs6/org.autojs.autojs.external.open.RunIntentActivity -d 'file:///sdcard/脚本/attendance-checkin/schedule_boot.js' -t 'application/x-javascript'
# also start the root shell watchdog (survives MIUI killing AutoJs6)
nohup /data/adb/service.d/checkin_watchdog.sh > /dev/null 2>&1 &
