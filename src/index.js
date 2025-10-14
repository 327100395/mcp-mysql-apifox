#!/usr/bin/env node

/**
 * MCP MySQL Server 主入口文件
 * 启动和管理MCP服务器实例
 */

const MCPMySQLServer = require('./server');

// 解析命令行参数获取timeout
const args = process.argv.slice(2);
let timeout = 300000; // 默认5分钟

// 查找timeout参数
const timeoutIndex = args.findIndex(arg => arg === '--timeout' || arg === '-t');
if (timeoutIndex !== -1 && timeoutIndex + 1 < args.length) {
    const timeoutValue = parseInt(args[timeoutIndex + 1]);
    if (!isNaN(timeoutValue) && timeoutValue > 0) {
        timeout = timeoutValue * 1000; // 转换为毫秒
    }
}

// 创建服务器实例，传入timeout参数
const server = new MCPMySQLServer(timeout);

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  process.exit(1);
});

// 启动服务器
server.start().catch((error) => {
  console.error('服务器启动失败:', error);
  process.exit(1);
});