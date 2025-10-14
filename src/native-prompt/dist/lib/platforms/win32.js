"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayMask = exports.displayBox = void 0;
var child_process_1 = require("child_process");
var path_1 = require("path");
function displayBox(title, body, defaultText, timeout) {
    if (defaultText === void 0) { defaultText = ""; }
    if (timeout === void 0) { timeout = 0; }
    return new Promise(function (resolve) {
        var spawnOptions = {};
        if (timeout > 0) {
            spawnOptions.timeout = timeout;
        }
        
        var boxSpawner = child_process_1.spawn("cscript", 
            [
                path_1.resolve(__dirname, '../../../', 'native/win32/default.vbs').replace("app.asar", "app.asar.unpacked"),
                title,
                body,
                defaultText
            ], spawnOptions);
        boxSpawner.stdout.on('data', function (d) {
            var data = d.toString();
            if (data.startsWith("RETURN"))
                resolve(data.replace("RETURN", "").trim() || null);
        });
        boxSpawner.on('exit', function (code, signal) { 
            if (signal === 'SIGTERM') {
                resolve(-1); // 超时被终止时返回-1
            } else {
                resolve(null);
            }
        });
        boxSpawner.on('error', function (error) {
            if (error.code === 'ETIMEDOUT') {
                resolve(-1); // 超时时返回-1
            } else {
                resolve(null);
            }
        });
    });
}
exports.displayBox = displayBox;
function displayMask(title, body, defaultText, timeout) {
    if (defaultText === void 0) { defaultText = ""; }
    if (timeout === void 0) { timeout = 0; }
    return new Promise(function (resolve) {
        var spawnOptions = {};
        if (timeout > 0) {
            spawnOptions.timeout = timeout;
        }
        
        var boxSpawner = child_process_1.spawn("powershell", [
            "-ExecutionPolicy", "Bypass", "-File", path_1.resolve(__dirname, '../../../', 'native/win32/mask.ps1').replace("app.asar", "app.asar.unpacked"),
            title,
            body,
            defaultText
        ], spawnOptions);
        boxSpawner.stdout.on('data', function (d) {
            console.error('osascript d:', d);
            var data = d.toString();
            if (data.startsWith("RETURN"))
                resolve(data.replace("RETURN", "").trim() || null);
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
}
exports.displayMask = displayMask;
