#!/system/bin/sh
# AutoJS6 attendance checkin - start schedule loop on boot
sleep 15
am start -n org.autojs.autojs6/org.autojs.autojs.external.open.RunIntentActivity -d 'file:///sdcard/脚本/attendance-checkin/schedule_boot.js' -t 'application/x-javascript'
