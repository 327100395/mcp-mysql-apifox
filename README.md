
## 主要功能

- 不同项目连接不同
- 在 Mysql 数据库执行 SQL
- 添加接口文档到 Apifox
- 从 Apifox 下载所有API到本地文件

## 安装与使用

1. 克隆项目
   ```bash
   git clone https://github.com/327100395/mysql-mcp.git
   cd mysql-mcp
   ```
2. 安装依赖
   ```bash
   npm install
   ```
3. 配置MCP服务
   ```json
    {
      "mcpServers": {
      "mysql": {
        "command": "node",
        "args": [
              "<工具路径>/src/index.js"
          ]
        }
      }
    }
   ```
   4. 建议在项目定义下面规则
      ```md
         - 如果要使用mysql相关功能,使用该DSN: `mysql://user:password@host:port/database`
         - 接口文档管理规范(注意必须在明确"创建/更新接口文档"时才操作)：
            - 使用 import_openapi 工具导入，项目信息：
               - 项目ID: <apiFox项目id>
               - API密钥: <apiFox密钥>
               - 保存接口根路径: `.apiDoc`目录
            - 接口文件规范：
               - 文件位置在保存接口根路径下
               - 目录结构：按 tags 属性数组顺序创建子目录
               - 文件命名：使用 summary 属性值，格式为 JSON
               - 每次仅允许导入单个接口文件。
      ```

## 可用命令

### execute_mysql
执行MySQL语句，需要提供DSN连接字符串。

**参数：**
- `dsn`: MySQL数据库连接字符串，格式：`mysql://user:password@host:port/database`
- `sql`: 要执行的SQL语句
- `params`: SQL查询参数（可选）

### import_openapi
导入OpenAPI数据到Apifox。

**参数：**
- `input`: JSON、YAML或X-YAML格式的OpenAPI数据字符串，或文件路径
- `projectId`: Apifox项目ID
- `apiKey`: Apifox API密钥

### download_apis
从Apifox下载所有API到本地文件。

**参数：**
- `rootDir`: 下载文件的根目录路径
- `projectId`: Apifox项目ID
- `apiKey`: Apifox API密钥

**功能说明：**
- 下载完整的OpenAPI 3.1规范文档

### run_curl
解析并执行curl命令，返回HTTP请求结果。

**参数：**
- `curl`: curl命令字符串

**功能说明：**
- 自动解析curl命令中的URL、HTTP方法、请求头、请求体等信息
- 使用axios执行实际的HTTP请求
- 返回完整的响应信息，包括状态码、响应头和响应数据
- 支持所有标准的curl参数和选项
