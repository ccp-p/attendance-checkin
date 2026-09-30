"auto";
files.write("/sdcard/attendance_checkin/simple_test.txt", "pkg=" + currentPackage() + "\n");
files.append("/sdcard/attendance_checkin/simple_test.txt", "width=" + device.width + " height=" + device.height + "\n");
app.launchPackage("com.cmri.ercs.yqx");
sleep(8000);
files.append("/sdcard/attendance_checkin/simple_test.txt", "after launch pkg=" + currentPackage() + "\n");
var root = auto.rootInActiveWindow;
files.append("/sdcard/attendance_checkin/simple_test.txt", "root=" + (root !== null) + "\n");
var texts = [];
var nodes = className("android.widget.TextView").find();
for (var i = 0; i < nodes.size() && i < 20; i++) { texts.push(nodes.get(i).text()); }
files.append("/sdcard/attendance_checkin/simple_test.txt", "texts: " + texts.join(" | ") + "\n");
