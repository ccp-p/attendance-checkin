#!/data/data/com.termux/files/usr/bin/sh
crontab /sdcard/checkin_crontab
echo "=== INSTALLED ==="
crontab -l
echo "=== DONE ==="