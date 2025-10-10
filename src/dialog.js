const nativePrompt = require('native-prompt');

async function showConfirmationDialog(message, callback) {
    try {
        const result1 = await nativePrompt(message, '确认', { defaultText: '' });
        // 如果结果是base64编码，先解码
        const decodedResult1 = base64Decode(result1);
        callback(0, decodedResult1, null);
    } catch (error) {
        callback(0, '', null);
    }
}

function base64Decode(str) {
    if (!str) return str;
    try {
        return Buffer.from(str, 'base64').toString('utf8');
    } catch (error) {
        console.warn('Base64解码失败，返回原始字符串:', error.message);
        return str;
    }
}

module.exports = {
    showConfirmationDialog
};
