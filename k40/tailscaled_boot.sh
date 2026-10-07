#!/system/bin/sh
# tailscaled boot service - auto start on device boot
# wait for boot to complete
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done
sleep 5
# start tailscaled if not already running
if ! pgrep -x tailscaled > /dev/null; then
    mkdir -p /data/adb/tailscale/state
    nohup /data/adb/tailscale/bin/tailscaled \
        --state=/data/adb/tailscale/state/tailscaled.state \
        --socket=/data/adb/tailscale/tailscaled.sock \
        --tun=userspace-networking \
        > /data/adb/tailscale/state/tailscaled.log 2>&1 &
fi
