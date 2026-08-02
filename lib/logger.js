var config = require("../config.js");

var logger = {
    _file: config.logFile,
    _floaty: null,
    _floatyText: null,
    _lines: [],
    _maxLines: 12,

    init: function () {
        try {
            files.createWithDirs(this._file);
        } catch (e) {
            console.error("init log dir failed: " + e);
        }
        this.info("log ready: " + this._file);
    },

    initFloaty: function () {
        try {
            var that = this;
            this._floaty = floaty.window(
                '<frame gravity="center" bg="#E0000000" padding="8">' +
                '<text id="log" textSize="11" textColor="#00FF00" maxLines="12" />' +
                '</frame>'
            );
            this._floatyText = this._floaty.log;
            this._floaty.setPosition(0, 120);
        } catch (e) {
            console.error("init floaty failed: " + e);
        }
    },

    _updateFloaty: function () {
        if (!this._floatyText) return;
        try {
            var that = this;
            ui.run(function () {
                that._floatyText.setText(that._lines.join("\n"));
            });
        } catch (e) {}
    },

    _ts: function () {
        var d = new Date();
        function p(n) { return (n < 10 ? "0" : "") + n; }
        return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    },

    write: function (level, msg) {
        var line = "[" + this._ts() + "] [" + level + "] " + msg;
        console.log(line);
        try {
            var f = new java.io.File(this._file);
            if (f.exists() && f.length() > config.maxLogSize) {
                files.move(this._file, this._file + ".old");
            }
            files.append(this._file, line + "\n");
        } catch (e) {
            console.error("write log failed: " + e);
        }
        var short = this._ts() + " " + msg;
        this._lines.push(short);
        if (this._lines.length > this._maxLines) {
            this._lines.shift();
        }
        this._updateFloaty();
    },

    info: function (msg) { this.write("INFO", msg); },
    warn: function (msg) { this.write("WARN", msg); },
    error: function (msg) { this.write("ERROR", msg); },
    ok: function (msg) { this.write(" OK ", msg); },

    closeFloaty: function () {
        if (this._floaty) {
            try { this._floaty.close(); } catch (e) {}
        }
    }
};

module.exports = logger;
