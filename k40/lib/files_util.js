// files_util.js - minimal file helpers (AutoJs6 API wrapper)
var files_util = {
    ensureDir: function (dir) {
        try { files.createWithDirs(dir + "placeholder"); } catch (e) {}
    },
    write: function (path, content) {
        try {
            files.createWithDirs(path);
            files.write(path, content);
            return true;
        } catch (e) { console.error("write " + path + ": " + e); return false; }
    },
    read: function (path) {
        try {
            if (!files.exists(path)) return null;
            return files.read(path);
        } catch (e) { return null; }
    }
};
module.exports = files_util;
