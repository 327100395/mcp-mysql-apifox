/**
 * SQL验证器
 * 提供SQL语句的安全性验证功能
 */

class SQLValidator {
    constructor() {
      // 危险关键词列表
      this.dangerousKeywords = [
        'drop table', 'drop database', 'truncate',
        'alter table', 'create database', 'drop index',
        'create user', 'drop user', 'grant', 'revoke',
        'load_file', 'into outfile', 'into dumpfile',
        'exec', 'execute', 'sp_', 'xp_'
      ];
      
      // 允许的操作类型
      this.allowedOperations = ['select', 'insert', 'update', 'delete', 'show'];
    }
  
    /**
     * 验证SQL语句的安全性
     * @param {string} sql - 要验证的SQL语句
     * @returns {Object} 验证结果
     */
    validateSQL(sql) {
      if (!sql || typeof sql !== 'string') {
        return {
          isValid: false,
          error: 'SQL语句不能为空且必须是字符串'
        };
      }
  
      const cleanSQL = sql.toLowerCase().trim();
      
      // 检查是否包含危险关键词
      for (const keyword of this.dangerousKeywords) {
        if (cleanSQL.includes(keyword)) {
          return {
            isValid: false,
            error: `检测到危险操作: ${keyword}`
          };
        }
      }
  
      const operation = this.getOperationType(cleanSQL);
  
      // 检查SQL注入风险
      const injectionCheck = this.checkSQLInjection(cleanSQL);
      if (!injectionCheck.isValid) {
        return injectionCheck;
      }
  
      return {
        isValid: true,
        operation: operation
      };
    }
  
    /**
     * 获取SQL操作类型
     * @param {string} sql - SQL语句
     * @returns {string} 操作类型
     */
    getOperationType(sql) {
      const trimmed = sql.trim();
      if (trimmed.startsWith('select')) return 'select';
      if (trimmed.startsWith('insert')) return 'insert';
      if (trimmed.startsWith('update')) return 'update';
      if (trimmed.startsWith('delete')) return 'delete';
      return 'unknown';
    }
  
    /**
     * 检查SQL注入风险
     * @param {string} sql - SQL语句
     * @returns {Object} 检查结果
     */
    checkSQLInjection(sql) {
      // 检查常见的SQL注入模式
      const injectionPatterns = [
        /union\s+select/i,
        /;\s*(drop|delete|update|insert)/i,
        /--\s*$/,
        /\/\*.*?\*\//,
        /'.*?'.*?or.*?'.*?'=/i,
        /".*?".*?or.*?".*?"=/i
      ];
  
      for (const pattern of injectionPatterns) {
        if (pattern.test(sql)) {
          return {
            isValid: false,
            error: '检测到潜在的SQL注入风险'
          };
        }
      }
  
      return { isValid: true };
    }
  
    /**
     * 验证SQL查询参数
     * @param {Array} params - 查询参数
     * @returns {Object} 验证结果
     */
    validateParams(params) {
      if (!Array.isArray(params)) {
        return {
          isValid: false,
          error: '参数必须是数组'
        };
      }
      
      // 检查参数类型
      for (let i = 0; i < params.length; i++) {
        const param = params[i];
        const type = typeof param;
        
        if (param !== null && !['string', 'number', 'boolean'].includes(type)) {
          return {
            isValid: false,
            error: `参数 ${i+1} 类型无效: ${type}`
          };
        }
      }
      
      return {
        isValid: true
      };
    }
    
    /**
     * 验证数据库连接参数
     * @param {Object} config - 连接配置
     * @returns {Object} 验证结果
     */
    validateConnectionConfig(config) {
      if (!config || typeof config !== 'object') {
        return {
          isValid: false,
          error: '连接配置必须是对象'
        };
      }
      
      // 检查必要参数
      const requiredFields = ['host', 'user', 'password', 'database'];
      for (const field of requiredFields) {
        if (!config[field]) {
          return {
            isValid: false,
            error: `缺少必要参数: ${field}`
          };
        }
      }
      
      // 验证主机名
      if (typeof config.host !== 'string') {
        return {
          isValid: false,
          error: '主机名必须是字符串'
        };
      }
      
      // 验证端口号
      if (config.port && (typeof config.port !== 'number' || config.port < 1 || config.port > 65535)) {
        return {
          isValid: false,
          error: '端口号必须是1-65535之间的数字'
        };
      }
      
      return {
        isValid: true
      };
    }
    
    /**
     * 验证DSN连接字符串
     * @param {string} dsn - 数据库连接字符串
     * @returns {Object} 验证结果
     */
    validateDSN(dsn) {
      if (!dsn || typeof dsn !== 'string') {
        return {
          isValid: false,
          error: 'DSN必须是字符串'
        };
      }
      
      // 验证DSN格式
      const dsnRegex = /^mysql:\/\/([^:]+):([^@]+)@([^:]+)(?::(\d+))?\/([^?]+)(?:\?.*)?$/;
      if (!dsnRegex.test(dsn)) {
        return {
          isValid: false,
          error: 'DSN格式无效，正确格式为：mysql://user:password@host:port/database'
        };
      }
      
      // 提取端口号并验证
      const portMatch = dsn.match(/:([0-9]+)\//); 
      if (portMatch) {
        const port = parseInt(portMatch[1]);
        if (port < 1 || port > 65535) {
          return {
            isValid: false,
            error: '端口号必须是1-65535之间的数字'
          };
        }
      }
      
      return {
        isValid: true
      };
    }
  }
  
  module.exports = SQLValidator;