#!/system/bin/sh
# install checkin watchdog as a Magisk module with init service
set -e
MOD=/data/adb/modules/checkin_watchdog
mkdir -p $MOD/system/etc/init
cp /data/local/tmp/wd_prop $MOD/module.prop
cp /data/local/tmp/wd_rc $MOD/system/etc/init/checkin_watchdog.rc
chmod 644 $MOD/module.prop $MOD/system/etc/init/checkin_watchdog.rc
rm /data/local/tmp/wd_prop /data/local/tmp/wd_rc
echo "module installed at $MOD"
ls -la $MOD $MOD/system/etc/init
