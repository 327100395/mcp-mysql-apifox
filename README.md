
## 主要功能

- 不同项目连接不同
- 在 Mysql 数据库执行 SQL
- 添加接口文档到 Apifox

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
      - 如果要编辑接口文档,使用import_openapi,项目id:{apifox项目id},api密钥:{apifox项目密钥},每次仅导入一个接口json文件，导入前在 `.apiDoc` 目录下编辑接口文件（路径为`[工作区根目录]/.apiDoc/[tags]/[summary].json`）。
   ```
