/**
 * 数据库连接和操作模块
 * 负责MySQL数据库的连接、查询执行等功能
 */

const mysql = require('mysql2/promise');
const config = require('./config');

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.currentConfig = null;
  }

  /**
   * 初始化数据库连接池
   */
  async initialize() {
    // 使用默认配置初始化连接
    return this.connect({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });
  }
  
  /**
   * 使用DSN连接到MySQL数据库
   * @param {string} dsn - 数据库连接字符串，格式：mysql://user:password@host:port/database
   * @returns {Object} 连接结果
   */
  async connectWithDSN(dsn) {
    try {
      // 解析DSN
      const dsnInfo = this.parseDSN(dsn);
      if (!dsnInfo) {
        return {
          success: false,
          error: 'DSN格式无效'
        };
      }
      
      // 检查是否已经连接到相同的数据库
      if (this.isConnected && this.currentConfig && 
          this.currentConfig.host === dsnInfo.host && 
          this.currentConfig.port === dsnInfo.port && 
          this.currentConfig.user === dsnInfo.user && 
          this.currentConfig.database === dsnInfo.database) {
        return {
          success: true,
          message: '已经连接到相同的数据库',
          alreadyConnected: true,
          connectionInfo: dsnInfo
        };
      }
      
      // 如果已有连接，先关闭
      if (this.pool) {
        await this.close();
      }
      
      // 创建新的连接池
      this.pool = mysql.createPool(dsn);

      // 测试连接
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      
      this.isConnected = true;
      this.currentConfig = dsnInfo;
      console.log('✓ 数据库连接成功');
      
      return {
        success: true,
        message: '数据库连接成功',
        connectionInfo: dsnInfo
      };
    } catch (error) {
      console.error('✗ 数据库连接失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 解析DSN连接字符串
   * @param {string} dsn - 数据库连接字符串
   * @returns {Object|null} 解析后的连接信息
   */
  parseDSN(dsn) {
    try {
      // 匹配DSN格式：mysql://user:password@host:port/database
      const regex = /mysql:\/\/([^:]+):([^@]+)@([^:]+)(?::(\d+))?\/([^?]+)(?:\?.*)?/;
      const match = dsn.match(regex);
      
      if (!match) {
        return null;
      }
      
      return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: match[4] ? parseInt(match[4]) : 3306,
        database: match[5]
      };
    } catch (error) {
      console.error('DSN解析错误:', error.message);
      return null;
    }
  }
  
  /**
   * 连接到MySQL数据库（使用配置对象）
   * @param {Object} dbConfig - 数据库连接配置
   * @returns {Object} 连接结果
   */
  async connect(dbConfig) {
    try {
      // 检查是否已经连接到相同的数据库
      if (this.isConnected && this.currentConfig && 
          this.currentConfig.host === dbConfig.host && 
          this.currentConfig.port === dbConfig.port && 
          this.currentConfig.user === dbConfig.user && 
          this.currentConfig.database === dbConfig.database) {
        return {
          success: true,
          message: '已经连接到相同的数据库',
          alreadyConnected: true,
          connectionInfo: {
            host: dbConfig.host,
            port: dbConfig.port || 3306,
            user: dbConfig.user,
            database: dbConfig.database
          }
        };
      }
      
      // 如果已有连接，先关闭
      if (this.pool) {
        await this.close();
      }
      
      // 创建新的连接池
      this.pool = mysql.createPool({
        host: dbConfig.host,
        port: dbConfig.port || config.database.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        connectionLimit: config.database.connectionLimit,
        acquireTimeout: config.database.acquireTimeout,
        timeout: config.database.timeout,
        reconnect: config.database.reconnect,
        multipleStatements: false // 禁用多语句执行以提高安全性
      });

      // 测试连接
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      
      this.isConnected = true;
      this.currentConfig = { ...dbConfig };
      console.log('✓ 数据库连接成功');
      
      return {
        success: true,
        message: '数据库连接成功',
        connectionInfo: {
          host: dbConfig.host,
          port: dbConfig.port || 3306,
          user: dbConfig.user,
          database: dbConfig.database
        }
      };
    } catch (error) {
      console.error('✗ 数据库连接失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 执行SQL查询
   * @param {string} sql - SQL语句
   * @param {Array} params - 查询参数
   * @returns {Object} 查询结果
   */
  async executeQuery(sql, params = []) {
    if (!this.isConnected) {
      throw new Error('数据库未连接');
    }

    let connection;
    try {
      connection = await this.pool.getConnection();
      
      const startTime = Date.now();
      const [rows, fields] = await connection.execute(sql, params);
      const executionTime = Date.now() - startTime;

      // 根据操作类型返回不同的结果格式
      const operation = this.getOperationType(sql);
      
      return {
        success: true,
        operation: operation,
        data: rows,
        fields: fields ? fields.map(f => ({
          name: f.name,
          type: f.type,
          length: f.length
        })) : [],
        rowCount: Array.isArray(rows) ? rows.length : rows.affectedRows || 0,
        executionTime: executionTime,
        insertId: rows.insertId || null
      };
    } catch (error) {
      console.error('SQL执行错误:', error.message);
      return {
        success: false,
        error: error.message,
        sqlState: error.sqlState || null,
        errno: error.errno || null
      };
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  /**
   * 获取数据库表信息
   * @returns {Object} 表信息
   */
  async getTablesInfo() {
    try {
      const tablesResult = await this.executeQuery('SHOW TABLES');
      if (!tablesResult.success) {
        return tablesResult;
      }

      const tables = [];
      for (const row of tablesResult.data) {
        const tableName = Object.values(row)[0];
        
        // 获取表结构
        const structureResult = await this.executeQuery(`DESCRIBE ${tableName}`);
        if (structureResult.success) {
          tables.push({
            name: tableName,
            columns: structureResult.data
          });
        }
      }

      return {
        success: true,
        data: tables
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取SQL操作类型
   * @param {string} sql - SQL语句
   * @returns {string} 操作类型
   */
  getOperationType(sql) {
    const trimmed = sql.toLowerCase().trim();
    if (trimmed.startsWith('select')) return 'SELECT';
    if (trimmed.startsWith('insert')) return 'INSERT';
    if (trimmed.startsWith('update')) return 'UPDATE';
    if (trimmed.startsWith('delete')) return 'DELETE';
    return 'UNKNOWN';
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      console.log('✓ 数据库连接已关闭');
    }
  }

  /**
   * 获取连接状态
   * @returns {boolean} 连接状态
   */
  isConnectionActive() {
    return this.isConnected;
  }
  
  /**
   * 获取当前连接信息
   * @returns {Object} 连接信息
   */
  getConnectionInfo() {
    if (!this.isConnected || !this.currentConfig) {
      return {
        connected: false
      };
    }
    
    return {
      connected: true,
      host: this.currentConfig.host,
      port: this.currentConfig.port,
      user: this.currentConfig.user,
      database: this.currentConfig.database
    };
  }
}

module.exports = DatabaseManager;