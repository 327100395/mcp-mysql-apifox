const nativePrompt = require('./native-prompt/dist/index.js');

async function showConfirmationDialog(message, callback, timeout = 300000) {
    try {
        const result1 = await nativePrompt(message, message, { defaultText: '', timeout: timeout });
        // 如果结果是base64编码，先解码
        const decodedResult1 = isBase64(result1) ? base64Decode(result1) : result1;
        callback(0, decodedResult1, null);
    } catch (error) {
        callback(0, '', null);
    }
}

function isBase64(str) {
    if (!str || typeof str !== 'string') return false;
    
    // Base64字符串的基本特征检查
    // 1. 长度必须是4的倍数（除了可能的填充）
    // 2. 只包含Base64字符集：A-Z, a-z, 0-9, +, /, =
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    
    if (!base64Regex.test(str)) return false;
    
    // 长度检查（Base64编码后的长度应该是4的倍数）
    if (str.length % 4 !== 0) return false;
    
    // 尝试解码验证
    try {
        const decoded = Buffer.from(str, 'base64').toString('utf8');
        const reencoded = Buffer.from(decoded, 'utf8').toString('base64');
        return reencoded === str;
    } catch (error) {
        return false;
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
