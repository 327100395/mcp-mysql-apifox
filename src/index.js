#!/usr/bin/env node

const args = process.argv.slice(2);
const passwordIndex = args.indexOf('-pwd');
if (passwordIndex !== -1) {
    const password = args[passwordIndex + 1];
    if (!password || password.startsWith('-')) {
        console.error('启动参数 -pwd 后必须提供非空密码。');
        process.exit(1);
    }
    require('./project-config').setEncryptionPassword(password);
    args.splice(passwordIndex, 2);
}

if (args[0] === 'config' || args[0] === 'init') {
    require('./init').startInit(args.slice(1)).catch((error) => {
        console.error(`打开配置页面失败：${error.message}`);
        process.exit(1);
    });
} else {
    const MCPMySQLServer = require('./server');
    const server = new MCPMySQLServer();
    process.on('uncaughtException', (error) => {
        console.error('未捕获的异常:', error);
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        console.error('未处理的 Promise 拒绝:', reason);
        process.exit(1);
    });
    server.start().catch((error) => {
        console.error('服务器启动失败:', error);
        process.exit(1);
    });
}
