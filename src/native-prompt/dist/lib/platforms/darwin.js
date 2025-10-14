"use strict";
var child_process_1 = require("child_process");
var path_1 = require("path");
module.exports = function (title, body, mask, defaultText, timeout) {
    if (defaultText === void 0) { defaultText = ""; }
    if (timeout === void 0) { timeout = 0; }
    return new Promise(function (resolve) {
        var spawnOptions = {};
        if (timeout > 0) {
            spawnOptions.timeout = timeout;
        }
        
        var nativePath = mask ? "./native/darwin/mask.scpt" : "./native/darwin/default.scpt";
        var boxSpawner = child_process_1.spawn("osascript", [path_1.resolve(__dirname, "../../../", nativePath).replace("app.asar", "app.asar.unpacked"), title, body, defaultText], spawnOptions);
        boxSpawner.stdout.on('data', function (d) {
            var data = d.toString();
            if (data)
                resolve(data.trim().split("text returned:").pop() || null);
        });
        boxSpawner.on('exit', function (code, signal) { 
            if (signal === 'SIGTERM') {
                resolve(-1); // 超时被终止时返回-1
            } else {
                resolve(null);
            }
        });
        boxSpawner.on('error', function (error) {
            console.error('osascript error:', error);
            if (error.code === 'ETIMEDOUT') {
                resolve(-1); // 超时时返回-1
            } else {
                resolve(null);
            }
        });
    });
};
