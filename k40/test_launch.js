"auto";
files.write("/sdcard/attendance_checkin/simple_test.txt", "start\n");
var cmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
cmd[0] = "su"; cmd[1] = "-c"; cmd[2] = "am force-stop com.cmri.ercs.yqx";
files.append("/sdcard/attendance_checkin/simple_test.txt", "cmd built\n");
try {
  var pb = new java.lang.ProcessBuilder(cmd);
  pb.start().waitFor();
  files.append("/sdcard/attendance_checkin/simple_test.txt", "force-stop ok\n");
} catch(e) {
  files.append("/sdcard/attendance_checkin/simple_test.txt", "force-stop ERR: " + e + "\n");
}
sleep(1500);
home();
sleep(1000);
files.append("/sdcard/attendance_checkin/simple_test.txt", "pkg before launch: " + currentPackage() + "\n");
app.launchPackage("com.cmri.ercs.yqx");
for (var i = 0; i < 15; i++) {
  sleep(2000);
  var pkg = currentPackage();
  files.append("/sdcard/attendance_checkin/simple_test.txt", "poll " + i + " pkg=" + pkg + "\n");
  if (pkg === "com.cmri.ercs.yqx") break;
}
files.append("/sdcard/attendance_checkin/simple_test.txt", "final pkg=" + currentPackage() + "\n");
