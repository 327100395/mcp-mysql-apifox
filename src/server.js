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
const {getDatabaseConfig, getApifoxConfig, getFtpConfig} = require('./project-config');
const {FtpManager} = require('./ftp');
const {startConfig} = require('./init');

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
        this.ftpManager = new FtpManager();
        this.configServers = new Set();
        this.validator = new SQLValidator();
        this.setupHandlers();
    }

    /**
     * 处理只读MySQL查询请求
     * @param {Object} args - 请求参数
     * @returns {Object} 查询结果
     */
    async handleExecuteMySQLReadonly(args) {
        const {sql, params = []} = args;
        let dsn;
        try {
            ({dsn} = getDatabaseConfig(args.projectRoot, args.database || 'default'));
        } catch (error) {
            return this.formatResponse('fail', error.message);
        }

        // 验证DSN
        const dsnValidation = this.validator.validateDSN(dsn);
        if (!dsnValidation.isValid) {
            return this.formatResponse("fail", `${dsnValidation.error}`);
        }

        // 验证只读SQL语句
        // const sqlValidation = this.validator.validateReadOnlySQL(sql);
        // if (!sqlValidation.isValid) {
        //     return this.formatResponse("fail", `${sqlValidation.error}`);
        // }

        // 验证参数
        const paramsValidation = this.validator.validateParams(params);
        if (!paramsValidation.isValid) {
            return this.formatResponse("fail", `${paramsValidation.error}`);
        }

        try {
            // 使用只读连接到数据库
            const connectResult = await this.dbManager.connectWithDSNReadonly(dsn);
            if (!connectResult.success) {
                return this.formatResponse("fail", `${connectResult.error}`);
            }

            // 执行只读SQL
            const result = await this.dbManager.executeQuery(sql, params, connectResult.db);

            if (result.success) {
                let executionTime = result.executionTime;
                let rowCount = result.rowCount;
                let data = result.data;

                return this.formatResponse("success", {executionTime, rowCount, data});
            } else {
                // 检查是否是因为只读模式导致的错误
                if (result.error && (
                    result.error.includes('read-only') || 
                    result.error.includes('READ ONLY') ||
                    result.error.includes('read only') ||
                    result.errno === 1290 || // MySQL read-only error
                    result.sqlState === 'HY000'
                )) {
                    return this.formatResponse("fail", `数据库处于只读模式，无法执行写操作。请使用execute_mysql_only工具执行写操作。`);
                }
                return this.formatResponse("fail", `${result.error}`);
            }
        } catch (error) {
            // 检查是否是只读相关的错误
            if (error.message && (
                error.message.includes('read-only') || 
                error.message.includes('READ ONLY') ||
                error.message.includes('read only')
            )) {
                return this.formatResponse("fail", `数据库处于只读模式，无法执行写操作。请使用execute_mysql_only工具执行写操作。`);
            }
            return this.formatResponse("fail", `${error.message}`);
        }
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

    async handleConfig(args) {
        try {
            let configServer;
            const result = await startConfig(args.projectRoot, {
                onClose: () => this.configServers.delete(configServer),
            });
            configServer = result.server;
            this.configServers.add(configServer);
            return this.formatResponse('success', '已打开本地配置页面，请用户在浏览器完成配置后再继续操作。');
        } catch (error) {
            return this.formatResponse('fail', error.message);
        }
    }

    getFtpTools() {
        const connection = {type: 'string', description: 'FTP 会话名（默认 default）'};
        const profile = {type: 'string', description: 'FTP 配置名称（默认 default）'};
        const remotePath = {type: 'string', description: '远程路径'};
        return [
            ['ftp_connect', '建立 FTP、FTPS 或 SFTP 连接', {projectRoot: {type: 'string', description: '项目根目录绝对路径'}, connection, profile}, ['projectRoot']],
            ['ftp_disconnect', '断开 FTP 连接', {connection}, []],
            ['ftp_list_connections', '列出活动 FTP 连接', {}, []],
            ['ftp_pwd', '显示当前远程目录', {connection}, []],
            ['ftp_cd', '切换远程目录', {connection, path: remotePath}, ['path']],
            ['ftp_list', '列出远程目录', {connection, path: remotePath}, []],
            ['ftp_upload', '上传本地文件到远程路径', {connection, localPath: {type: 'string', description: '本地相对文件路径'}, remotePath, mode: {type: 'string', enum: ['auto', 'ascii', 'binary']}}, ['localPath', 'remotePath']],
            ['ftp_download', '下载远程文件到本地路径', {connection, remotePath, localPath: {type: 'string', description: '本地相对目标路径'}}, ['remotePath', 'localPath']],
            ['ftp_delete', '删除远程文件', {connection, path: remotePath}, ['path']],
            ['ftp_rename', '重命名远程文件或目录', {connection, oldPath: remotePath, newPath: remotePath}, ['oldPath', 'newPath']],
            ['ftp_read', '读取远程文本文件', {connection, path: remotePath}, ['path']],
            ['ftp_write', '写入远程文本文件', {connection, path: remotePath, content: {type: 'string'}}, ['path', 'content']],
            ['ftp_append', '追加远程文本文件', {connection, path: remotePath, content: {type: 'string'}}, ['path', 'content']],
            ['ftp_stat', '查看远程文件信息', {connection, path: remotePath}, ['path']],
            ['ftp_exists', '检查远程路径是否存在', {connection, path: remotePath}, ['path']],
            ['ftp_mkdir', '创建远程目录', {connection, path: remotePath, recursive: {type: 'boolean'}}, ['path']],
            ['ftp_rmdir', '删除远程目录', {connection, path: remotePath, recursive: {type: 'boolean'}}, ['path']],
            ['ftp_chmod', '修改远程文件权限', {connection, path: remotePath, mode: {type: 'string', description: '八进制权限，例如 755'}}, ['path', 'mode']],
        ].map(([name, description, properties, required]) => ({name, description, inputSchema: {type: 'object', properties, required}}));
    }

    /**
     * 设置MCP服务器处理器
     */
    setupHandlers() {
        // 列出可用工具
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "config",
                        description: "打开指定项目的本地配置页面；仅在用户明确要求配置，或工具提示项目尚未配置时使用",
                        inputSchema: {
                            type: "object",
                            properties: {
                                projectRoot: {
                                    type: "string",
                                    description: "需要配置的项目根目录绝对路径"
                                }
                            },
                            required: ["projectRoot"]
                        }
                    },
                    {
                        name: "execute_mysql_only",
                        description: "执行任意 MySQL SQL，支持分号分隔的多条语句",
                        inputSchema: {
                            type: "object",
                            properties: {
                                projectRoot: {
                                    type: "string",
                                    description: "项目根目录绝对路径"
                                },
                                database: {
                                    type: "string",
                                    description: "数据库配置名称（默认 default）"
                                },
                                sql: {
                                    type: "string",
                                    description: "要执行的 SQL，可使用分号分隔多条语句"
                                },
                                params: {
                                    type: "array",
                                    description: "SQL 参数（可选）",
                                    items: {}
                                }
                            },
                            required: ["projectRoot", "sql"]
                        }
                    },
                    {
                        name: "execute_mysql_readonly",
                        description: "执行只读 MySQL 语句（SELECT、SHOW、DESCRIBE 等）",
                        inputSchema: {
                            type: "object",
                            properties: {
                                projectRoot: {
                                    type: "string",
                                    description: "项目根目录绝对路径"
                                },
                                database: {
                                    type: "string",
                                    description: "数据库配置名称（默认 default）"
                                },
                                sql: {
                                    type: "string",
                                    description: "要执行的只读SQL语句(SELECT、SHOW、DESCRIBE等),如果不是读操作将终止运行"
                                }
                            },
                            required: ["projectRoot", "sql"]
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
                        description: "将 OpenAPI 数据导入 Apifox；仅在用户明确要求生成或更新 API 文档时使用",
                        inputSchema: {
                            type: "object",
                            properties: {
                                input: {
                                    type: "string",
                                    description: "JSON 格式 OpenAPI 数据字符串，或接口文档json文件绝对路径（示例\"file#[路径]\"），或包含json文件的目录绝对路径（示例\"dir#[路径]\"）。注意路径可能有盘符"
                                },
                                projectRoot: {
                                    type: "string",
                                    description: "项目根目录绝对路径"
                                }
                            },
                            required: ["input", "projectRoot"]
                        }
                    },
                    {
                        name: "download_apis",
                        description: "从 Apifox 下载所有 API 到项目根目录的 .apiDoc 目录",
                        inputSchema: {
                            type: "object",
                            properties: {
                                projectRoot: {
                                    type: "string",
                                    description: "项目根目录绝对路径"
                                }
                            },
                            required: ["projectRoot"]
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
                    },
                    ...this.getFtpTools()
                ]
            };
        });

        // 执行工具调用
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const {name, arguments: args} = request.params;

            try {
                switch (name) {
                    case "config":
                        return await this.handleConfig(args || {});

                    case "connect_mysql":
                        return await this.handleConnectMySQL(args);

                    case "execute_sql":
                        return await this.handleExecuteSQL(args);

                    case "execute_mysql_only":
                        return await this.handleExecuteMySQL(args);

                    case "execute_mysql_readonly":
                        return await this.handleExecuteMySQLReadonly(args);

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
                        if (name.startsWith('ftp_')) return await this.handleFtp(name, args || {});
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

    resolveFtpLocalPath(client, requestedPath) {
        return path.resolve(client.config.projectRoot, requestedPath || '.');
    }

    async handleFtp(name, args) {
        const connection = args.connection || 'default';
        try {
            if (name === 'ftp_connect') {
                const profile = args.profile || 'default';
                const {ftp: ftpConfig} = getFtpConfig(args.projectRoot, profile);
                const client = await this.ftpManager.connect(connection, ftpConfig);
                return this.formatResponse('success', {
                    connection,
                    profile,
                    host: ftpConfig.host,
                    protocol: ftpConfig.protocol,
                    remoteDir: await client.pwd()
                });
            }
            if (name === 'ftp_list_connections') return this.formatResponse('success', this.ftpManager.list());
            if (name === 'ftp_disconnect') { await this.ftpManager.disconnect(connection); return this.formatResponse('success', `已断开 FTP 连接: ${connection}`); }

            const client = this.ftpManager.get(connection);
            switch (name) {
                case 'ftp_pwd': return this.formatResponse('success', await client.pwd());
                case 'ftp_cd': await client.cd(args.path); return this.formatResponse('success', await client.pwd());
                case 'ftp_list': return this.formatResponse('success', await client.list(args.path));
                case 'ftp_upload': {
                    const localPath = this.resolveFtpLocalPath(client, args.localPath);
                    await client.upload(localPath, args.remotePath, args.mode || 'auto');
                    return this.formatResponse('success', `已上传 ${localPath} -> ${args.remotePath}`);
                }
                case 'ftp_download': {
                    const localPath = this.resolveFtpLocalPath(client, args.localPath);
                    await client.download(args.remotePath, localPath);
                    return this.formatResponse('success', `已下载 ${args.remotePath} -> ${localPath}`);
                }
                case 'ftp_delete': await client.remove(args.path); return this.formatResponse('success', `已删除 ${args.path}`);
                case 'ftp_rename': await client.rename(args.oldPath, args.newPath); return this.formatResponse('success', `已重命名 ${args.oldPath} -> ${args.newPath}`);
                case 'ftp_read': return this.formatResponse('success', await client.read(args.path));
                case 'ftp_write': await client.write(args.path, args.content); return this.formatResponse('success', `已写入 ${args.path}`);
                case 'ftp_append': await client.write(args.path, args.content, true); return this.formatResponse('success', `已追加 ${args.path}`);
                case 'ftp_stat': return this.formatResponse('success', await client.stat(args.path));
                case 'ftp_exists': return this.formatResponse('success', await client.exists(args.path));
                case 'ftp_mkdir': await client.mkdir(args.path, args.recursive === true); return this.formatResponse('success', `已创建目录 ${args.path}`);
                case 'ftp_rmdir': await client.rmdir(args.path, args.recursive === true); return this.formatResponse('success', `已删除目录 ${args.path}`);
                case 'ftp_chmod': await client.chmod(args.path, args.mode); return this.formatResponse('success', `已修改权限 ${args.path} -> ${args.mode}`);
                default: throw new Error(`未知 FTP 工具: ${name}`);
            }
        } catch (error) {
            return this.formatResponse('fail', error.message);
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
        const {sql, params = []} = args;
        let dsn;
        try {
            ({dsn} = getDatabaseConfig(args.projectRoot, args.database || 'default'));
        } catch (error) {
            return this.formatResponse('fail', error.message);
        }


        // 验证DSN
        const dsnValidation = this.validator.validateDSN(dsn);
        if (!dsnValidation.isValid) {
            return this.formatResponse("fail", `${dsnValidation.error}`);
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

            // 不限制 SQL 类型，并允许分号分隔的多条 SQL 语句。
            const result = await this.dbManager.executeUnrestrictedQuery(sql, params, connectResult.db);

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
        let {input} = args;
        let projectId;
        let apiKey;

        try {
            ({projectId, apiKey} = getApifoxConfig(args.projectRoot));
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
        let rootDir;
        let projectId;
        let apiKey;

        try {
            const apifox = getApifoxConfig(args.projectRoot);
            rootDir = path.join(apifox.root, '.apiDoc');
            projectId = apifox.projectId;
            apiKey = apifox.apiKey;
            // 验证参数
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
        await this.ftpManager.closeAll();
        await Promise.all([...this.configServers].map((server) => new Promise((resolve) => server.close(resolve))));
        this.configServers.clear();
    }
}

module.exports = MCPMySQLServer;
