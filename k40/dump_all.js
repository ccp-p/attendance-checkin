"auto";

// 快速 dump 屏幕所有文字(包括 webview),输出到控制台和文件
console.show();
console.log("==== 开始 dump ====");

var all = [];
function collect(node) {
    if (!node) return;
    var t = node.text();
    var d = node.desc();
    if (t && t.length > 0) all.push("T:" + t);
    if (d && d.length > 0) all.push("D:" + d);
    for (var i = 0; i < node.childCount(); i++) {
        collect(node.child(i));
    }
}

var root = auto.rootInActiveWindow;
if (root) {
    collect(root);
} else {
    console.log("root 为空");
}

console.log("共找到 " + all.length + " 个文本:");
for (var i = 0; i < all.length; i++) {
    console.log("  " + all[i]);
}

// 也写文件
var outFile = "/sdcard/attendance_checkin/dump_all.txt";
files.createWithDirs(outFile);
files.write(outFile, all.join("\n"));
console.log("已保存到: " + outFile);
console.log("==== dump 结束 ====");
