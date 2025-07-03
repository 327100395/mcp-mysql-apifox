/**
 * 配置文件
 * 负责加载和管理应用配置
 */

require('dotenv').config();

const config = {
  // 数据库配置
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user:  'root',
    password: '',
    database: '',
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true
  },
  
  // 服务器配置
  server: {
    port: parseInt(process.env.PORT) || 3000,
    environment: process.env.NODE_ENV || 'development'
  },
  
  // MCP配置
  mcp: {
    name: process.env.MCP_SERVER_NAME || 'mysql-mcp-server',
    version: process.env.MCP_SERVER_VERSION || '1.0.0'
  },
  
  // Apifox配置
  apifox: {
    apiKey: process.env.APIFOX_API_KEY || '',
    defaultProjectId: process.env.APIFOX_DEFAULT_PROJECT_ID || '',
    endpointFolderId: parseInt(process.env.APIFOX_ENDPOINT_FOLDER_ID) || 0,
    schemaFolderId: parseInt(process.env.APIFOX_SCHEMA_FOLDER_ID) || 0
  }
};

module.exports = config;