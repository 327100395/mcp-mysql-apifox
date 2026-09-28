## 主要功能

- 在多个命名 MySQL 配置中执行 SQL
- 管理 Apifox 接口文档
- 解析并执行 curl 命令
- 通过多个命名 FTP、FTPS 或 SFTP 配置操作远程目录

## 安装与初始化

1. 配置 MCP 服务：

   ```json
   {
     "mcpServers": {
       "mysql-apifox": {
         "command": "npx",
         "args": ["-y", "mcp-mysql-apifox", "-pwd", "<your-encryption-password>"]
       }
     }
   }
   ```

2. 让 AI 先调用 MCP 的 `config` 工具，并传入目标项目的绝对路径 `projectRoot`。该工具会打开仅监听 `127.0.0.1` 的本地配置页面后立即返回；页面会保留 1 小时，保存后自动关闭。可添加任意数量的数据库和 FTP 配置，保存后生成加密的 `.env.mma`。

   也可在终端执行：

   ```bash
   npx -y mcp-mysql-apifox config /absolute/path/to/project -pwd "your-encryption-password"
   # 或安装到本地后：npm run config -- /absolute/path/to/project -pwd "your-encryption-password"
   ```

   已有配置需要在页面确认覆盖，也可用 `--force` 跳过确认。

   配置必须先通过程序启动参数 `-pwd <密码>` 设置全局 ENV 加密密码；密码仅在当前进程内存中使用，不保存到用户目录。新版使用 PBKDF2-SHA256 派生 AES-256-GCM 密钥。历史加密格式仍可读取；通过配置页重新保存后将迁移为当前密码加密格式。密码需在后续每次启动时提供才能解密新版配置。注意：命令行参数可能被本机进程查看，请在可信环境中使用。

3. `.env.mma` 已加入 `.gitignore`，不要提交它。旧版单套 dotenv 配置仍可读取；重新通过初始化页面保存即可升级为加密格式。

## 多配置使用

- MySQL 工具的可选 `database` 参数指定数据库配置名；不传时使用 `default`。
- `ftp_connect` 的可选 `profile` 参数指定 FTP 配置名；`connection` 仍是本次运行的 FTP 会话名，两者可不同。

例如，先用 `database: "reporting"` 访问报表库；再以 `profile: "backup"`、`connection: "backup-session"` 建立备份服务器会话。工具错误只会提示缺失或不可用的配置名称，不会返回凭据或配置文件内容。

## 可用工具

### `execute_mysql_only`

执行任意 MySQL SQL，支持分号分隔的多条语句。

- `projectRoot`: 项目根目录绝对路径
- `database`: 数据库配置名称（可选，默认 `default`）
- `sql`: SQL 语句
- `params`: SQL 参数（可选）

### `execute_mysql_readonly`

执行只读 MySQL 语句。

- `projectRoot`: 项目根目录绝对路径
- `database`: 数据库配置名称（可选，默认 `default`）
- `sql`: SQL 语句

### `import_openapi` / `download_apis`

导入 OpenAPI 数据到 Apifox，或下载 Apifox API 到项目 `.apiDoc` 目录。二者均需传入 `projectRoot`。

### `run_curl`

解析并执行 curl 命令。

- `curl`: curl 命令字符串

### FTP 工具

先调用 `ftp_connect(projectRoot, connection?, profile?)`，然后可使用 `ftp_list`、`ftp_cd`、`ftp_upload`、`ftp_download`、`ftp_delete`、`ftp_rename`、`ftp_read`、`ftp_write`、`ftp_append`、`ftp_stat`、`ftp_exists`、`ftp_mkdir`、`ftp_rmdir` 和 `ftp_chmod`。

上传和下载的相对本地路径以建立该会话时传入的项目根目录解析。
