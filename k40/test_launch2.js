"auto";
files.write("/sdcard/attendance_checkin/simple_test.txt", "start\n");
var cmd = java.lang.reflect.Array.newInstance(java.lang.String, 3);
cmd[0] = "su"; cmd[1] = "-c"; cmd[2] = "am force-stop com.cmri.ercs.yqx";
new java.lang.ProcessBuilder(cmd).start().waitFor();
sleep(1500); home(); sleep(1000);
files.append("/sdcard/attendance_checkin/simple_test.txt", "force-stopped, pkg=" + currentPackage() + "\n");
var cmd2 = java.lang.reflect.Array.newInstance(java.lang.String, 3);
cmd2[0] = "su"; cmd2[1] = "-c"; cmd2[2] = "am start -n com.cmri.ercs.yqx/com.cmic.module_main.ui.activity.WelcomeActivity";
var p = new java.lang.ProcessBuilder(cmd2); p.redirectErrorStream(true);
var is = p.start().getInputStream();
var reader = new java.io.BufferedReader(new java.io.InputStreamReader(is));
var line; var output = "";
while ((line = reader.readLine()) !== null) { output += line + "\n"; }
files.append("/sdcard/attendance_checkin/simple_test.txt", "am start output: " + output + "\n");
for (var i = 0; i < 15; i++) {
  sleep(2000);
  var pkg = currentPackage();
  if (i % 3 === 0) files.append("/sdcard/attendance_checkin/simple_test.txt", "poll " + i + " pkg=" + pkg + "\n");
  if (pkg === "com.cmri.ercs.yqx") break;
}
files.append("/sdcard/attendance_checkin/simple_test.txt", "final pkg=" + currentPackage() + "\n");
