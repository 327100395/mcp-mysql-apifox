
## 主要功能

- 不同项目连接不同
- 在 Mysql 数据库执行 SQL
- 添加接口文档到 Apifox
- 从 Apifox 下载所有API到本地文件
- 解析并执行 curl 命令
- 通过 FTP、FTPS 或 SFTP 操作项目关联的远程目录

FTP 实现参考并整合自 [kemalabuteliyte/ftp-mcp](https://github.com/kemalabuteliyte/ftp-mcp)，连接配置已改为本项目的 `.env.mma` 工作流。

## 安装与使用
1. 配置MCP服务
   ```json
    {
      "mcpServers": {
        "mysql-apifox": {
          "command": "npx",
          "args": [
              "-y",
              "mcp-mysql-apifox"
          ]
        }
      }
    }
   ```
2. 使用数据库、Apifox 或 FTP 前，必须在 `projectRoot`（项目根目录绝对路径）创建并填写 `.env.mma`。首次调用如果发现该文件不存在，会生成空模板并返回待填写项；填写完成后再重试。

   ```dotenv
   # 数据库
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=user
   DB_PASSWORD=password
   DB_NAME=database

   # Apifox
   APIFOX_API_KEY=
   APIFOX_PROJECT_ID=

   # FTP / FTPS / SFTP
   FTP_HOST=
   FTP_PORT=
   FTP_PROTOCOL=
   FTP_USERNAME=
   FTP_PASSWORD=
   FTP_PRIVATE_KEY_PATH=
   FTP_PASSPHRASE=
   ```

   `FTP_PROTOCOL` 留空时默认为 `ftp`，`FTP_PORT` 留空时 FTP 使用端口 `21`；使用 `ftps` 或 `sftp` 时请分别填写对应协议和端口。

   `.env.mma` 已加入 `.gitignore`，不要提交其中的凭据。

3. 建议在项目规则中定义
      ```md
         - 数据库、Apifox 和 FTP 操作均传入项目根目录绝对路径 `projectRoot`，凭据只从 `projectRoot/.env.mma` 读取。
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
执行 MySQL 语句，使用项目根目录中的数据库连接信息。

**参数：**
- `projectRoot`: 项目根目录绝对路径
- `sql`: 要执行的SQL语句
- `params`: SQL查询参数（可选）

### import_openapi
导入OpenAPI数据到Apifox。

**参数：**
- `input`: JSON、YAML或X-YAML格式的OpenAPI数据字符串，或文件路径
- `projectRoot`: 项目根目录绝对路径（读取 Apifox 配置）

### download_apis
从Apifox下载所有API到本地文件。

**参数：**
- `projectRoot`: 项目根目录绝对路径；文件下载到 `.apiDoc`

**功能说明：**
- 下载完整的OpenAPI 3.1规范文档

### run_curl
解析并执行curl命令，返回HTTP请求结果。

**参数：**
- `curl`: curl命令字符串

**功能说明：**
- 自动解析curl命令中的URL、HTTP方法、请求头、请求体等信息
- 返回完整的响应信息，包括状态码、响应头和响应数据
- 支持所有标准的curl参数和选项

### FTP 命令

先调用 `ftp_connect(projectRoot, connection?)`。随后可使用 `ftp_list`、`ftp_cd`、`ftp_upload`、`ftp_download`、`ftp_delete`、`ftp_rename`、`ftp_read`、`ftp_write`、`ftp_append`、`ftp_stat`、`ftp_exists`、`ftp_mkdir`、`ftp_rmdir` 和 `ftp_chmod`。上传和下载支持绝对路径；相对本地路径以 `projectRoot` 解析。
