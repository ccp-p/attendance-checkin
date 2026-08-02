# 考勤自动打卡系统(AutoJS6 / 纯手机端)

完全在手机上运行、不需要连接电脑的自动打卡脚本。
基于安卓无障碍服务,无需 root。

## 功能概述

脚本自动完成打开应用、导航到打卡页面、签到、验证码登录的完整流程。
验证码通过 pushplus 转发到微信,脚本自动读取并回填。
支持定时打卡,到点自动执行,全程无需人工干预。

## 安装与配置

### 1. 安装 AutoJS6

手机上安装 AutoJS6。

### 2. 开启权限

- 无障碍服务:设置 -> 无障碍 -> AutoJS6
- 悬浮窗权限
- 后台运行/电池优化白名单
- 通知使用权(pushplus 通知需要)

### 3. 导入项目

把 `attendance-checkin` 文件夹放到手机 `/sdcard/脚本/` 下,在 AutoJS6 文件页打开。

### 4. 修改配置

编辑 `config.js`,关键项:

- `appPackage`: 应用包名
- `phoneInput`: 手机号后四位
- `text.*`: 界面文案,如应用更新改了文字需同步修改
- `schedule.times`: 定时打卡时间(默认 07:20 / 17:30)

## 运行

### 立即执行一次(测试)

打开 `main.js` -> 运行。屏幕左上角会显示实时日志悬浮窗。

### 定时自动打卡

`config.js` 里 `schedule.enabled` 改 `true`,设好 `times`。运行 `main.js` 后脚本常驻,到点自动执行。

## 日志

日志在 `/sdcard/attendance_checkin/log.txt`,超 2MB 自动轮转。
运行时屏幕左上角有悬浮窗实时显示最近日志。

## 常见问题

- **签到点不动**: 文字本身不可点击,脚本通过点坐标触发父容器。如界面改版导致坐标偏移,用 AutoJS6 布局分析重新确认。
- **验证码过期**: pushplus 转发延迟或取码流程太慢。可调小 `config.timeout.pushplusDelay`(默认 6000ms)。
- **登录按钮不见**: 输完验证码必须先收键盘,脚本已处理。
- **pushplus 通知找不到**: 确认短信转发器和 pushplus 通道正常工作。OPPO 机型注意从屏幕左侧下滑才是通知栏。
- **脚本被杀后台**: 加入电池白名单;或用 AutoJS6 定时任务在固定时间唤醒运行 `main.js`。

## 文件结构

```
attendance-checkin/
├── project.json     # AutoJS6 工程清单
├── main.js          # 入口:立即执行 or 定时循环
├── config.js        # 配置
├── schedule.js      # 定时调度
└── lib/
    ├── logger.js    # 日志 + 悬浮窗
    ├── ui.js        # 点击/输入/收集文字辅助
    ├── sms.js       # pushplus 微信取验证码
    └── flow.js      # 打卡流程编排
```
