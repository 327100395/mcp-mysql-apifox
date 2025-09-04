/**
 * MCP Server实现
 * 基于@modelcontextprotocol/sdk实现MySQL工具服务
 */

const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {StdioServerTransport} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const parseCurl = require('parse-curl');

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
     * 格式化响应为统一的JSON格式
     * @param {string} status - success 或 fail
     * @param res - 输出具体内容
     * @returns {Object} 格式化后的响应
     */
    formatResponse(status, res) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({status, res})
                }
            ]
        };
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
                                    description: "要执行的SQL语句,执行失败重试2次"
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
                        description: "导入OpenAPI数据到Apifox,使用前在规则定义项目ID和API密钥,可导入json字符串/包含json文档的目录/json文件",
                        inputSchema: {
                            type: "object",
                            properties: {
                                input: {
                                    type: "string",
                                    description: "JSON 格式 OpenAPI 数据字符串，或接口文档json文件绝对路径（示例\"file#[路径]\"），或包含json文件的目录绝对路径（示例\"dir#[路径]\"）。注意路径可能有盘符"
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
                    },
                    {
                        name: "download_apis",
                        description: "从Apifox下载所有API到指定目录,可传递目录绝对路径、Apifox项目ID和API密钥",
                        inputSchema: {
                            type: "object",
                            properties: {
                                rootDir: {
                                    type: "string",
                                    description: "下载文件的根目录路径"
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
                            required: ["rootDir", "projectId", "apiKey"]
                        }
                    },
                    {
                        name: "run_curl",
                        description: "解析并执行curl命令，返回HTTP请求结果",
                        inputSchema: {
                            type: "object",
                            properties: {
                                curl: {
                                    type: "string",
                                    description: "curl命令字符串，例如：curl -X GET https://api.example.com/users"
                                }
                            },
                            required: ["curl"]
                        }
                    }
                ]
            };
        });

        // 执行工具调用
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const {name, arguments: args} = request.params;

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

                    case "download_apis":
                        return await this.handleDownloadAPIs(args);

                    case "run_curl":
                        return await this.handleRunCurl(args);

                    default:
                        throw new Error(`未知的工具: ${name}`);
                }
            } catch (error) {
                return this.formatResponse("fail", `${error.message}`);
            }
        });
    }

    /**
     * 处理SQL执行请求
     * @param {Object} args - 请求参数
     * @returns {Object} 执行结果
     */
    async handleExecuteSQL(args) {
        const {sql, params = []} = args;

        // 验证SQL语句
        const sqlValidation = this.validator.validateSQL(sql);
        if (!sqlValidation.isValid) {
            return this.formatResponse("fail", `${sqlValidation.error}`);
        }

        // 验证参数
        const paramsValidation = this.validator.validateParams(params);
        if (!paramsValidation.isValid) {
            return this.formatResponse("fail", `${paramsValidation.error}`);
        }

        // 执行SQL
        const result = await this.dbManager.executeQuery(sql, params);

        if (result.success) {
            let executionTime = result.executionTime;
            let rowCount = result.rowCount;
            let data = result.data;

            return this.formatResponse("success", {executionTime, rowCount, data});
        } else {
            return this.formatResponse("fail", `${result.error}`);
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

            return this.formatResponse("success", responseText);
        } else {
            return this.formatResponse("fail", `${result.error}`);
        }
    }

    /**
     * 处理连接MySQL请求
     * @param {Object} args - 连接参数
     * @returns {Object} 连接结果
     */
    async handleConnectMySQL(args) {
        const {dsn} = args;

        // 验证连接参数
        const configValidation = this.validator.validateDSN(dsn);
        if (!configValidation.isValid) {
            return this.formatResponse("fail", `${configValidation.error}`);
        }

        // 连接数据库
        const result = await this.dbManager.connectWithDSN(dsn);

        if (result.success) {
            return this.formatResponse("success", "");
        } else {
            return this.formatResponse("fail", `${result.error}`);
        }
    }

    /**
     * 处理获取连接状态请求
     * @returns {Object} 连接状态
     */
    async handleGetConnectionStatus() {
        const connectionInfo = this.dbManager.getConnectionInfo();

        if (connectionInfo.connected) {
            return this.formatResponse("success", ``);
        } else {
            return this.formatResponse("fail", `未连接`);
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
        } catch (error) {

            process.exit(1);
        }
    }

    /**
     * 处理一步完成数据库连接和SQL执行的请求
     * @param {Object} args - 请求参数
     * @returns {Object} 执行结果
     */
    async handleExecuteMySQL(args) {
        const {dsn, sql, params = []} = args;


        // 验证DSN
        const dsnValidation = this.validator.validateDSN(dsn);
        if (!dsnValidation.isValid) {
            return this.formatResponse("fail", `${dsnValidation.error}`);
        }

        // 验证SQL语句
        const sqlValidation = this.validator.validateSQL(sql);
        if (!sqlValidation.isValid) {
            return this.formatResponse("fail", `${sqlValidation.error}`);
        }

        // 验证参数
        const paramsValidation = this.validator.validateParams(params);
        if (!paramsValidation.isValid) {
            return this.formatResponse("fail", `${paramsValidation.error}`);
        }

        try {

            // 重新连接数据库
            const connectResult = await this.dbManager.connectWithDSN(dsn);
            if (!connectResult.success) {
                return this.formatResponse("fail", `${connectResult.error}`);
            }

            // 执行SQL
            const result = await this.dbManager.executeQuery(sql, params, connectResult.db);

            if (result.success) {
                let executionTime = result.executionTime;
                let rowCount = result.rowCount;
                let data = result.data;

                return this.formatResponse("success", {executionTime, rowCount, data});
            } else {
                return this.formatResponse("fail", `${result.error}`);
            }
        } catch (error) {
            return this.formatResponse("fail", `${error.message}`);
        }
    }

    /**
     * 处理导入OpenAPI数据到Apifox的请求
     * @param {Object} args - 请求参数
     * @returns {Object} 导入结果
     */
    async handleImportOpenAPIToApifox(args) {
        let {input, projectId, apiKey} = args;

        try {
            let inputData;
            let isDirectory = false;
            let isFile = false;

            // 标准化路径分隔符，统一使用系统默认分隔符
            if (input.startsWith('file#') || input.startsWith('dir#')) {
                const prefix = input.startsWith('file#') ? 'file#' : 'dir#';
                const pathPart = input.substring(prefix.length);
                // 将路径中的正斜杠和反斜杠统一为系统默认分隔符
                input = prefix + pathPart.replace(/\\/g, path.sep).replace(/\//g, path.sep);
            } else {
                // 将路径中的正斜杠和反斜杠统一为系统默认分隔符
                input = input.replace(/\\/g, path.sep).replace(/\//g, path.sep);
            }

            // 检查是否需要处理前缀
            if (input.startsWith('file#')) {
                // 处理文件前缀
                input = input.substring(5); // 移除 'file#' 前缀
                isFile = true;
            } else if (input.startsWith('dir#')) {
                // 处理目录前缀
                input = input.substring(4); // 移除 'dir#' 前缀
                isDirectory = true;
            } else {
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
            }

            if (isFile) {
                // 处理单个文件
                try {
                    const fileContent = fs.readFileSync(input, 'utf8');
                    inputData = fileContent;

                    const result = await this.importSingleOpenAPI(inputData, projectId, apiKey);
                    return this.formatResponse("success", `✓ 文件 ${input} 导入成功`);
                } catch (error) {
                    return this.formatResponse("fail", `✗ 读取文件 ${input} 失败: ${error.message}`);
                }
            } else if (isDirectory) {
                // 处理目录中的所有json文件（包括子目录）
                try {
                    const jsonFiles = this.getAllJsonFiles(input);

                    if (jsonFiles.length === 0) {
                        return this.formatResponse("fail", `✗ 目录 ${input} 及其子目录中没有找到json文件`);
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

                    return this.formatResponse(failedFiles.length > 0 ? "fail" : "success", responseText);
                } catch (error) {
                    return this.formatResponse("fail", `✗ 读取目录 ${input} 失败: ${error.message}`);
                }
            } else {
                // 当作字符串处理
                inputData = input;
                const result = await this.importSingleOpenAPI(inputData, projectId, apiKey);
                return this.formatResponse("success", `✓ 导入成功`);
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

            return this.formatResponse("fail", `✗ OpenAPI数据导入失败: ${errorMessage}\n错误详情:\n${JSON.stringify(errorData, null, 2)}`);
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
            }
        };

        scanDirectory(dirPath);
        return jsonFiles;
    }

    /**
     * 处理下载APIs命令
     * @param {Object} args - 参数对象
     * @param {string} args.rootDir - 下载文件的根目录路径
     * @param {string} args.projectId - Apifox项目ID
     * @param {string} args.apiKey - Apifox API密钥
     */
    async handleDownloadAPIs(args) {
        const {rootDir, projectId, apiKey} = args;

        try {
            // 验证参数
            if (!rootDir || !projectId || !apiKey) {
                throw new Error('缺少必要参数: rootDir, projectId, apiKey');
            }

            // 确保根目录存在
            if (!fs.existsSync(rootDir)) {
                fs.mkdirSync(rootDir, {recursive: true});
            }

            // 调用Apifox API获取OpenAPI 3.1 JSON数据
            const openApiData = await this.downloadOpenAPIFromApifox(projectId, apiKey);

            // 解析并创建对应文件
            await this.createFilesFromOpenAPI(openApiData, rootDir);

            return {
                content: [
                    {
                        type: "text",
                        text: `✓ 成功从Apifox项目 ${projectId} 下载: ${rootDir}`
                    }
                ]
            };

        } catch (error) {
            throw new Error(`下载APIs失败: ${error.message}`);
        }
    }

    /**
     * 从Apifox下载OpenAPI数据
     * @param {string} projectId - 项目ID
     * @param {string} apiKey - API密钥
     */
    async downloadOpenAPIFromApifox(projectId, apiKey) {
        const requestData = {
            "scope": {
                "type": "ALL",
                "excludedByTags": ["pet"]
            },
            "options": {
                "includeApifoxExtensionProperties": false,
                "addFoldersToTags": false
            },
            "oasVersion": "3.1",
            "exportFormat": "JSON"
        };

        let lastError;
        // 重试3次
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await axios.post(
                    `https://api.apifox.com/v1/projects/${projectId}/export-openapi?locale=zh-CN`,
                    requestData,
                    {
                        headers: {
                            'X-Apifox-Api-Version': '2024-03-28',
                            'Authorization': 'Bearer ' + apiKey,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                if (response.status !== 200) {
                    throw new Error(`API请求失败: ${response.statusText}`);
                }

                return response.data;

            } catch (error) {
                lastError = error;

                if (attempt < 3) {
                    // 等待1秒后重试
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        throw new Error(`下载API数据失败，已重试3次: ${lastError.message}`);
    }

    /**
     * 安全处理文件名，转码特殊字符
     * @param {string} filename - 原始文件名
     * @returns {string} - 安全的文件名
     */
    sanitizeFileName(filename) {
        // 定义需要转码的特殊字符映射
        const charMap = {
            '/': '／',        // 全角斜杠
            '\\': '＼',      // 全角反斜杠
            ':': '：',        // 全角冒号
            '*': '＊',        // 全角星号
            '?': '？',        // 全角问号
            '"': '＂',        // 全角双引号
            '<': '＜',        // 全角小于号
            '>': '＞',        // 全角大于号
            '|': '｜'         // 全角竖线
        };

        let safeName = filename;
        for (const [char, replacement] of Object.entries(charMap)) {
            safeName = safeName.replace(new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
        }

        return safeName;
    }

    /**
     * 根据OpenAPI数据创建文件
     * @param {Object} openApiData - OpenAPI数据
     * @param {string} rootDir - 根目录
     */
    async createFilesFromOpenAPI(openApiData, rootDir) {
        // 如果有paths，为每个API端点创建单独的文件
        if (openApiData.paths) {
            for (const [pathKey, pathValue] of Object.entries(openApiData.paths)) {
                for (const [method, methodData] of Object.entries(pathValue)) {
                    // 获取summary作为文件名，并进行安全处理
                    const summary = methodData.summary || `${method}_${pathKey.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    const safeFileName = this.sanitizeFileName(summary);
                    const fileName = `${safeFileName}.json`;

                    // 获取tags作为目录结构
                    let targetDir = rootDir;
                    if (methodData.tags && methodData.tags.length > 0) {
                        // 为每个tag创建目录层级
                        for (const tag of methodData.tags) {
                            targetDir = path.join(targetDir, tag);
                        }
                    }

                    // 确保目录存在
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, {recursive: true});
                    }

                    const filePath = path.join(targetDir, fileName);

                    // 构建完整的OpenAPI结构，但paths中只包含当前API
                    const apiData = {
                        openapi: openApiData.openapi,
                        info: openApiData.info,
                        servers: openApiData.servers,
                        paths: {
                            [pathKey]: {
                                [method]: methodData
                            }
                        },
                        components: openApiData.components,
                        security: openApiData.security,
                        // tags: openApiData.tags,
                        externalDocs: openApiData.externalDocs
                    };

                    // 移除undefined的字段
                    Object.keys(apiData).forEach(key => {
                        if (apiData[key] === undefined) {
                            delete apiData[key];
                        }
                    });

                    fs.writeFileSync(filePath, JSON.stringify(apiData, null, 2), 'utf8');
                }
            }
        }
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

        if (response?.data?.data?.errors?.length) {
            throw new Error(response?.data?.data?.errors[0].message);
        } else if (response?.data?.errors?.length) {
            throw new Error(response?.data?.errors[0].message);
        } else if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`导入失败: ${response.statusText}`);
        }
    }

    /**
     * 处理curl命令执行请求
     * @param {Object} args - 请求参数
     * @returns {Object} 执行结果
     */
    async handleRunCurl(args) {
        try {
            const {curl} = args;

            if (typeof curl !== 'string') {
                throw new TypeError(`Expected String, Found ${typeof curl}`);
            }

            // 解析curl命令
            const parsed = parseCurl(curl);

            // 构建axios请求配置
            const requestConfig = {
                method: parsed.method || 'GET',
                url: parsed.url,
                headers: parsed.header || {},
            };

            // 如果有请求体数据
            if (parsed.body) {
                requestConfig.data = parsed.body;
            }

            // 执行HTTP请求
            const response = await axios(requestConfig);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers,
                            data: response.data
                        }, null, 2)
                    }
                ]
            };

        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `curl执行失败: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    }

    /**
     * 停止服务器
     */
    async stop() {
        await this.dbManager.close();
    }
}

module.exports = MCPMySQLServer;
