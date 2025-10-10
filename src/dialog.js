const dialog = require('dialog-node');
const iconv = require('iconv-lite');

function showConfirmationDialog(message, callback) {
    // 将回调函数包装，处理编码问题
    const encodingCallback = (code, retVal, stderr) => {
        // 如果返回值不为空，进行编码转换
        if (retVal) {
            retVal = iconv.decode(Buffer.from(retVal, 'binary'), 'cp936');
        }
        callback(code, retVal, stderr);
    };
    dialog.entry(message, '确认', 0, encodingCallback);
}

module.exports = {
    showConfirmationDialog
};
