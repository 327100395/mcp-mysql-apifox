const nativePrompt = require('./native-prompt/dist/index.js');

async function showConfirmationDialog(message, callback) {
    try {
        // 创建一个10分钟超时的Promise
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('TIMEOUT'));
            }, 5 * 60 * 1000); // 5分钟
        });

        // 使用Promise.race来实现超时机制
        const result1 = await Promise.race([
            nativePrompt(message, message, { defaultText: '' }),
            timeoutPromise
        ]);
        
        // 如果结果是base64编码，先解码
        const decodedResult1 = base64Decode(result1);
        callback(0, decodedResult1, null);
    } catch (error) {
        if (error.message === 'TIMEOUT') {
            // 超时情况，返回特殊标识
            callback(0, null, 'TIMEOUT');
        } else {
            callback(0, '', null);
        }
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
