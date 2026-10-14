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
const path = require('path');
const parseCurl = require('parse-curl');
const DatabaseManager = require('./database');
const SQLValidator = require('./validators');
const config = require('./config');
const {loadProjectConfig, getDatabaseConfig, getFtpConfig} = require('./project-config');
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
            await startConfig(args.projectRoot, {
                onReady: ({server}) => {
                    configServer = server;
                    this.configServers.add(server);
                },
                onClose: () => this.configServers.delete(configServer),
            });
            return this.formatResponse('success', '已打开本地配置页面，页面将在 1 小时后自动关闭。');
        } catch (error) {
            return this.formatResponse('fail', error.message);
        }
    }

    handleListConfigs(args) {
        const config = loadProjectConfig(args.projectRoot);
        if (config.created) throw new Error(config.message);
        return this.formatResponse('success', {
            databases: config.data.databases.map((profile) => profile.name),
            ftps: config.data.ftps.map((profile) => profile.name),
        });
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
                        description: "打开指定项目的本地配置页面；页面会保留 1 小时，保存成功后自动关闭。仅在用户明确要求配置，或工具提示项目尚未配置时使用",
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
                        name: "list_configs",
                        description: "列出指定项目已保存的数据库和 FTP 配置名称；不返回凭据，不建立连接",
                        inputSchema: {
                            type: "object",
                            properties: {
                                projectRoot: {type: "string", description: "项目根目录绝对路径"}
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

                    case "list_configs":
                        return this.handleListConfigs(args || {});

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
