# k40 手动打卡速查（紧急情况）

## 一键打卡（最常用）

电脑连着 k40（USB 或 WiFi adb）时：

```bash
# 完整打卡流程（自动：导航→打卡→验证码→提交→微信通知你）
adb shell "su -c 'sh /data/checkin/run_autojs.sh all'"
```

**只发这一条命令就行**，剩下的全自动。完成后看微信 pushplus 通知（带打卡成功截图）。

---

## 分场景手动操作（某个环节出问题时单独重跑）

```bash
# 场景名: launch nav attendance location login getcode ppapi inputcode submit result

# 例：只重新取验证码（验证码轮询失败时）
adb shell "su -c 'sh /data/checkin/run_autojs.sh getcode'"

# 例：只重新提交（输完码没提交成功时）
adb shell "su -c 'sh /data/checkin/run_autojs.sh submit'"

# 例：只验证打卡结果+发通知（打卡了但没收到通知时）
adb shell "su -c 'sh /data/checkin/run_autojs.sh result'"
```

查看进度/失败原因：

```bash
adb shell "su -c 'tail -20 /sdcard/checkin/autojs/log.txt'"
```

---

## 完全没有电脑时（手机上直接操作）

k40 上打开 **AutoJs6** app → 文件 → `attendance-checkin-k40` → 长按 `scenes_main.js` → **运行**。
默认跑完整流程。跑之前如果只想跑某场景：先建参数文件

```bash
# Termux 或任何终端模拟器（root）:
echo all > /sdcard/checkin/autojs/scene.args   # all 换成场景名
```

---

## 自动定时（已配置，无需手动）

工作日 07:20 / 17:31 自动打卡，已验证 crond 在跑：

```bash
adb shell "su -c 'cat /data/local/tmp/cron/crontabs/root'"   # 查看计划
adb shell "su -c 'tail -5 /data/checkin/heartbeat.log'"       # 确认 crond 活着
```

---

## 兜底方案（AutoJs6 挂了/无障碍坏了）

```bash
# root shell 流程，不依赖无障碍服务
adb shell "su -c 'rm -rf /sdcard/checkin/.running; sh /data/checkin/checkin.sh'"
adb shell "su -c 'tail -20 /sdcard/checkin/checkin.log'"
```

注意 shell 流程取码依赖手机上的 curl 访问 pushplus（已修尾斜杠），成功后同样会走完。

---

## 常见故障速查

| 症状 | 处理 |
|---|---|
| 没收到微信通知但可能已打卡 | `run_autojs.sh result` 重新验证+补发通知 |
| 卡在可信认证/认证失败页 | `run_autojs.sh submit`（会循环按左上角返回退层） |
| 位置信息获取失败弹窗反复出现 | `run_autojs.sh location` 单独测恢复；多次失败检查手机定位/GPS |
| 验证码收不到 | `run_autojs.sh ppapi` 看日志；pushplus 网页确认短信转发到了 |
| AutoJs6 无障碍被杀 | cron 入口会自动重启绑定并降级 shell 流程；手动可重启手机后开 AutoJs6 |
