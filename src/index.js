#!/usr/bin/env node

/**
 * MCP MySQL Server 主入口文件
 * 启动和管理MCP服务器实例
 */

const MCPMySQLServer = require('./server');

// 创建服务器实例
const server = new MCPMySQLServer();

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