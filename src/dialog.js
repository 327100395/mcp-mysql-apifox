const nativePrompt = require('./native-prompt/dist/index.js');

async function showConfirmationDialog(message, callback, timeout = 300000) {
    try {
        const result1 = await nativePrompt(message, message, { defaultText: '', timeout: timeout });
        // 如果结果是URL编码，先解码
        const decodedResult1 = urlDecode(result1);
        callback(0, decodedResult1, null);
    } catch (error) {
        callback(0, '', null);
    }
}

function urlDecode(str) {
    if (!str) return str;
    try {
        return decodeURIComponent(str);
    } catch (error) {
        console.warn('URL解码失败，返回原始字符串:', error.message);
        return str;
    }
}

module.exports = {
    showConfirmationDialog
};
