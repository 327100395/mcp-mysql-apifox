
## 主要功能

- 不同项目连接不同
- 执行 SQL
- 导入 OpenAPI 数据到 Apifox
- 
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
4. 在项目定义下面规则
   ```md
      - 如果要使用`tools`工具调用mysql相关功能,使用该DSN: `mysql://user:password@host:port/database`
      - 如果要创建接口,调用`tools`工具的`import_openapi`,Apifox项目ID:"...",Apifox的API密钥:"..."
   ```
