/**
 * MCP Server实现
 * 基于@modelcontextprotocol/sdk实现MySQL工具服务
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DatabaseManager = require('./database');
const SQLValidator = require('./validators');
const config = require('./config');

class MCPMySQLServer {
  constructor() {
    this.server = new Server({
      name: config.mcp.name,
      version: config.mcp.version,
    }, {
      capabilities: {
        tools: {},
      },
    });
    
    this.dbManager = new DatabaseManager();
    this.validator = new SQLValidator();
    this.setupHandlers();
  }

  /**
   * 设置MCP服务器处理器
   */
  setupHandlers() {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // {
          //   name: "connect_mysql",
          //   description: "连接到MySQL数据库",
          //   inputSchema: {
          //     type: "object",
          //     properties: {
          //       dsn: {
          //         type: "string",
          //         description: "MySQL数据库连接字符串，DSN格式：mysql://user:password@host:port/database"
          //       }
          //     },
          //     required: ["dsn"]
          //   }
          // },
          // {
          //   name: "execute_sql",
          //   description: "执行SQL语句（需要先连接数据库）",
          //   inputSchema: {
          //     type: "object",
          //     properties: {
          //       sql: {
          //         type: "string",
          //         description: "要执行的SQL语句"
          //       },
          //       params: {
          //         type: "array",
          //         description: "SQL查询参数（可选）",
          //         items: {
          //           type: ["string", "number", "boolean", "null"]
          //         }
          //       }
          //     },
          //     required: ["sql"]
          //   }
          // },
          {
            name: "execute_mysql",
            description: "执行mysql语句,使用前在规则定义DSN链接",
            inputSchema: {
              type: "object",
              properties: {
                dsn: {
                  type: "string",
                  description: "MySQL数据库连接字符串，DSN格式：mysql://user:password@host:port/database"
                },
                sql: {
                  type: "string",
                  description: "要执行的SQL语句"
                },
                params: {
                  type: "array",
                  description: "SQL查询参数（可选）",
                  items: {
                    type: ["string", "number", "boolean", "null"]
                  }
                }
              },
              required: ["dsn", "sql"]
            }
          },
          // {
          //   name: "get_tables_info",
          //   description: "获取数据库表结构信息",
          //   inputSchema: {
          //     type: "object",
          //     properties: {}
          //   }
          // },
          // {
          //   name: "get_connection_status",
          //   description: "获取数据库连接状态",
          //   inputSchema: {
          //     type: "object",
          //     properties: {}
          //   }
          // },
          {
            name: "import_openapi",
            description: "导入OpenAPI数据到Apifox,使用前在规则定义项目ID和API密钥",
            inputSchema: {
              type: "object",
              properties: {
                input: {
                  type: "string",
                  description: "JSON、YAML 或 X-YAML 格式 OpenAPI 数据字符串，或接口文档json文件绝对路径，或包含json文件的目录绝对路径"
                },
                projectId: {
                  type: "string",
                  description: "Apifox项目ID"
                },
                apiKey: {
                  type: "string",
                  description: "Apifox API密钥"
                }
              },
              required: ["input", "projectId", "apiKey"]
            }
          }
        ]
      };
    });

    // 执行工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "connect_mysql":
            return await this.handleConnectMySQL(args);
            
          case "execute_sql":
            return await this.handleExecuteSQL(args);
          
          case "execute_mysql":
            return await this.handleExecuteMySQL(args);
          
          case "get_tables_info":
            return await this.handleGetTablesInfo();
          
          case "get_connection_status":
            return await this.handleGetConnectionStatus();
          
          case "import_openapi":
            return await this.handleImportOpenAPIToApifox(args);
          
          default:
            throw new Error(`未知的工具: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `错误: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });
  }

  /**
   * 处理SQL执行请求
   * @param {Object} args - 请求参数
   * @returns {Object} 执行结果
   */
  async handleExecuteSQL(args) {
    const { sql, params = [] } = args;

    // 验证SQL语句
    const sqlValidation = this.validator.validateSQL(sql);
    if (!sqlValidation.isValid) {
      return {
        content: [
          {
            type: "text",
            text: `SQL验证失败: ${sqlValidation.error}`
          }
        ],
        isError: true
      };
    }

    // 验证参数
    const paramsValidation = this.validator.validateParams(params);
    if (!paramsValidation.isValid) {
      return {
        content: [
          {
            type: "text",
            text: `参数验证失败: ${paramsValidation.error}`
          }
        ],
        isError: true
      };
    }

    // 执行SQL
    const result = await this.dbManager.executeQuery(sql, params);
    
    if (result.success) {
      let responseText = `✓ SQL执行成功\n`;
      responseText += `执行时间: ${result.executionTime}ms\n`;
      responseText += `影响行数: ${result.rowCount}\n`;
      
      if (result.insertId) {
        responseText += `插入ID: ${result.insertId}\n`;
      }
      
      if (result.data) {
        responseText += `\n结果:\n`;
        responseText += JSON.stringify(result.data, null, 2);
      }

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `✗ SQL执行失败: ${result.error}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * 处理获取表信息请求
   * @returns {Object} 表信息
   */
  async handleGetTablesInfo() {
    const result = await this.dbManager.getTablesInfo();
    
    if (result.success) {
      let responseText = `数据库表信息:\n\n`;
      
      for (const table of result.data) {
        responseText += `表名: ${table.name}\n`;
        responseText += `字段信息:\n`;
        
        for (const column of table.columns) {
          responseText += `  - ${column.Field} (${column.Type}) ${column.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${column.Key ? column.Key : ''}\n`;
        }
        responseText += `\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `获取表信息失败: ${result.error}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * 处理连接MySQL请求
   * @param {Object} args - 连接参数
   * @returns {Object} 连接结果
   */
  async handleConnectMySQL(args) {
    const { dsn } = args;
    
    // 验证连接参数
    const configValidation = this.validator.validateDSN(dsn);
    if (!configValidation.isValid) {
      return {
        content: [
          {
            type: "text",
            text: `连接参数验证失败: ${configValidation.error}`
          }
        ],
        isError: true
      };
    }
    
    // 连接数据库
    const result = await this.dbManager.connectWithDSN(dsn);
    
    if (result.success) {
      let responseText = "";
      
      if (result.alreadyConnected) {
        responseText = `✓ 已经连接到相同的数据库\n`;
      } else {
        responseText = `✓ 数据库连接成功\n`;
      }
      
      responseText += `DSN: ${dsn.replace(/:[^:]*@/, ':******@')}\n`;
      if (result.connectionInfo) {
        responseText += `主机: ${result.connectionInfo.host}\n`;
        responseText += `端口: ${result.connectionInfo.port}\n`;
        responseText += `用户: ${result.connectionInfo.user}\n`;
        responseText += `数据库: ${result.connectionInfo.database}\n`;
      }
      
      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `✗ 数据库连接失败: ${result.error}`
          }
        ],
        isError: true
      };
    }
  }
  
  /**
   * 处理获取连接状态请求
   * @returns {Object} 连接状态
   */
  async handleGetConnectionStatus() {
    const connectionInfo = this.dbManager.getConnectionInfo();
    
    if (connectionInfo.connected) {
      return {
        content: [
          {
            type: "text",
            text: `数据库连接状态: 已连接\n主机: ${connectionInfo.host}\n端口: ${connectionInfo.port}\n用户: ${connectionInfo.user}\n数据库: ${connectionInfo.database}`
          }
        ]
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `数据库连接状态: 未连接`
          }
        ]
      };
    }
  }

  /**
   * 启动MCP服务器
   */
  async start() {
    try {
      // 启动MCP服务器
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      console.log(`✓ MCP MySQL Server 启动成功`);
      console.log(`服务器名称: ${config.mcp.name}`);
      console.log(`服务器版本: ${config.mcp.version}`);
    } catch (error) {
      console.error('✗ MCP服务器启动失败:', error.message);
      process.exit(1);
    }
  }

  /**
   * 处理一步完成数据库连接和SQL执行的请求
   * @param {Object} args - 请求参数
   * @returns {Object} 执行结果
   */
  async handleExecuteMySQL(args) {
    const { dsn, sql, params = [] } = args;
    
    // 验证DSN
    const dsnValidation = this.validator.validateDSN(dsn);
    if (!dsnValidation.isValid) {
      return {
        content: [
          {
            type: "text",
            text: `连接参数验证失败: ${dsnValidation.error}`
          }
        ],
        isError: true
      };
    }
    
    // 验证SQL语句
    const sqlValidation = this.validator.validateSQL(sql);
    if (!sqlValidation.isValid) {
      return {
        content: [
          {
            type: "text",
            text: `SQL验证失败: ${sqlValidation.error}`
          }
        ],
        isError: true
      };
    }

    // 验证参数
    const paramsValidation = this.validator.validateParams(params);
    if (!paramsValidation.isValid) {
      return {
        content: [
          {
            type: "text",
            text: `参数验证失败: ${paramsValidation.error}`
          }
        ],
        isError: true
      };
    }
    
    // 连接数据库
    const connectResult = await this.dbManager.connectWithDSN(dsn);
    if (!connectResult.success) {
      return {
        content: [
          {
            type: "text",
            text: `✗ 数据库连接失败: ${connectResult.error}`
          }
        ],
        isError: true
      };
    }
    
    // 执行SQL
    const result = await this.dbManager.executeQuery(sql, params);
    
    if (result.success) {
      let responseText = `✓ 成功执行SQL\n`;
      responseText += `DSN: ${dsn.replace(/:[^:]*@/, ':******@')}\n`;
      responseText += `执行时间: ${result.executionTime}ms\n`;
      responseText += `影响行数: ${result.rowCount}\n`;
      
      if (result.insertId) {
        responseText += `插入ID: ${result.insertId}\n`;
      }
      
      if (result.data) {
        responseText += `\n结果:\n`;
        responseText += JSON.stringify(result.data, null, 2);
      }

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `✗ SQL执行失败: ${result.error}`
          }
        ],
        isError: true
      };
    }
  }
  
  /**
   * 处理导入OpenAPI数据到Apifox的请求
   * @param {Object} args - 请求参数
   * @returns {Object} 导入结果
   */
  async handleImportOpenAPIToApifox(args) {
    const { input, projectId, apiKey} = args;
    
    try {
      let inputData;
      let isDirectory = false;
      let isFile = false;
      
      // 检查input是否为文件路径或目录路径
      try {
        const stats = fs.statSync(input);
        if (stats.isFile()) {
          isFile = true;
        } else if (stats.isDirectory()) {
          isDirectory = true;
        }
      } catch (e) {
        // 不是有效路径，当作字符串处理
      }
      
      if (isFile) {
        // 处理单个文件
        try {
          const fileContent = fs.readFileSync(input, 'utf8');
          inputData = fileContent;
          
          const result = await this.importSingleOpenAPI(inputData, projectId, apiKey);
          return {
            content: [
              {
                type: "text",
                text: `✓ 文件 ${input} 导入成功`
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `✗ 读取文件 ${input} 失败: ${error.message}`
              }
            ],
            isError: true
          };
        }
      } else if (isDirectory) {
        // 处理目录中的所有json文件（包括子目录）
        try {
          const jsonFiles = this.getAllJsonFiles(input);
          
          if (jsonFiles.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `✗ 目录 ${input} 及其子目录中没有找到json文件`
                }
              ],
              isError: true
            };
          }
          
          const results = [];
          const failedFiles = [];
          
          for (const filePath of jsonFiles) {
            try {
              const fileContent = fs.readFileSync(filePath, 'utf8');
              const result = await this.importSingleOpenAPI(fileContent, projectId, apiKey);
              const relativePath = path.relative(input, filePath);
              results.push({
                file: relativePath,
                success: true,
                result: result
              });
            } catch (error) {
              const relativePath = path.relative(input, filePath);
              failedFiles.push({
                file: relativePath,
                path: filePath,
                error: error.message
              });
            }
          }
          
          let responseText = `批量导入完成:\n`;
          
          if (results.length > 0) {
            responseText += `成功导入的文件:\n`;
            results.forEach(r => {
              responseText += `✓ ${r.file}\n`;
            });
            responseText += `\n`;
          }
          
          if (failedFiles.length > 0) {
            responseText += `导入失败的文件:\n`;
            failedFiles.forEach(f => {
              responseText += `✗ ${f.file} (${f.path}): ${f.error}\n`;
            });
          }
          
          return {
            content: [
              {
                type: "text",
                text: responseText
              }
            ],
            isError: failedFiles.length > 0
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `✗ 读取目录 ${input} 失败: ${error.message}`
              }
            ],
            isError: true
          };
        }
      } else {
        // 当作字符串处理
        inputData = input;
        const result = await this.importSingleOpenAPI(inputData, projectId, apiKey);
        return {
          content: [
            {
              type: "text",
              text: `✓ 导入成功`
            }
          ]
        };
      }
    } catch (error) {
      let errorMessage = error.message;
      let errorData = {};
      
      // 尝试提取API错误信息
      if (error.response && error.response.data) {
        errorData = error.response.data;
        if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        }
      }
      
      return {
        content: [
          {
            type: "text",
            text: `✗ OpenAPI数据导入失败: ${errorMessage}\n错误详情:\n${JSON.stringify(errorData, null, 2)}`
          }
        ],
        isError: true
      };
    }
  }
  
  /**
   * 递归获取目录及其子目录中的所有JSON文件
   * @param {string} dirPath - 目录路径
   * @returns {Array} JSON文件路径数组
   */
  getAllJsonFiles(dirPath) {
    const jsonFiles = [];
    
    const scanDirectory = (currentPath) => {
      try {
        const items = fs.readdirSync(currentPath);
        
        for (const item of items) {
          const fullPath = path.join(currentPath, item);
          const stats = fs.statSync(fullPath);
          
          if (stats.isDirectory()) {
            // 递归扫描子目录
            scanDirectory(fullPath);
          } else if (stats.isFile() && path.extname(item).toLowerCase() === '.json') {
            // 添加JSON文件
            jsonFiles.push(fullPath);
          }
        }
      } catch (error) {
        // 忽略无法访问的目录
        console.warn(`无法访问目录: ${currentPath}, 错误: ${error.message}`);
      }
    };
    
    scanDirectory(dirPath);
    return jsonFiles;
  }

  /**
   * 导入单个OpenAPI数据到Apifox
   * @param {string} inputData - OpenAPI数据字符串
   * @param {string} projectId - Apifox项目ID
   * @param {string} apiKey - Apifox API密钥
   * @returns {Object} 导入结果
   */
  async importSingleOpenAPI(inputData, projectId, apiKey) {
    // 准备请求数据
    const requestData = {
      input: inputData
    };
    
    // 发送请求到Apifox API
    const response = await axios.post(
      `https://api.apifox.com/v1/projects/${projectId}/import-openapi?locale=zh-CN`,
      requestData,
      {
        headers: {
          'X-Apifox-Api-Version': '2024-03-28',
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.status === 200) {
      return response.data;
    } else {
      if(response?.data?.data?.errors?.length) {
        throw new Error(response?.data?.data?.errors[0].message);
      }
      if(response?.data?.errors?.length) {
        throw new Error(response?.data?.errors[0].message);
      }
      throw new Error(`导入失败: ${response.statusText}`);
    }
  }

  /**
   * 停止服务器
   */
  async stop() {
    await this.dbManager.close();
    console.log('✓ MCP服务器已停止');
  }
}

module.exports = MCPMySQLServer;