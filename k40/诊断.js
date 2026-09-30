"auto";

// 诊断脚本:打印当前应用包名、Activity 和屏幕上所有可见文字。
// 用法:停在你要确认的页面,运行本脚本,把控制台输出截图发回来。

function p(n) { return (n < 10 ? "0" : "") + n; }
var d = new Date();
var ts = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());

console.show();
console.log("==================== 诊断 " + ts + " ====================");

try {
    console.log("当前包名: " + currentPackage());
} catch (e) { console.log("currentPackage 失败: " + e); }

try {
    console.log("当前 Activity: " + currentActivity());
} catch (e) { console.log("currentActivity 失败: " + e); }

try {
    console.log("屏幕尺寸: " + device.width + " x " + device.height);
} catch (e) {}

// 收集所有 TextView 文字(去重保序)
var texts = {};
var order = [];
try {
    var nodes = className("android.widget.TextView").find();
    console.log("---- 屏幕可见文字(" + nodes.size() + " 个)----");
    for (var i = 0; i < nodes.size(); i++) {
        var t = nodes.get(i).text();
        if (t && !texts[t]) {
            texts[t] = true;
            order.push(t);
        }
    }
} catch (e) {
    console.log("读取 TextView 失败: " + e);
}

for (var j = 0; j < order.length; j++) {
    console.log("  " + order[j]);
}

// 收集所有可点击节点的 desc(底部 tab 常用 desc)
var descs = {};
var dorder = [];
try {
    var clickable = clickable(true).find();
    console.log("---- 可点击节点的 desc(" + clickable.size() + " 个)----");
    for (var k = 0; k < clickable.size(); k++) {
        var dc = clickable.get(k).desc();
        var tx = clickable.get(k).text();
        var key = (dc ? "[desc]" + dc : "") + (tx ? "[text]" + tx : "");
        if (key && !descs[key]) {
            descs[key] = true;
            dorder.push(key);
        }
    }
} catch (e) {
    console.log("读取可点击节点失败: " + e);
}

for (var m = 0; m < dorder.length; m++) {
    console.log("  " + dorder[m]);
}

// 保存到文件方便复制
var outFile = "/sdcard/attendance_checkin/diag_" + ts.replace(/[: ]/g, "") + ".txt";
files.createWithDirs(outFile);
var content = "包名: " + currentPackage() + "\n文字:\n" + order.join("\n") + "\n可点击:\n" + dorder.join("\n");
files.write(outFile, content);
console.log("已保存到: " + outFile);
console.log("==================== 诊断结束 ====================");
console.log("把以上内容截图发回,我据此校准配置");
