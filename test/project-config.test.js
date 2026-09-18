const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {ENV_FILE, loadProjectConfig, saveProjectConfig, getDatabaseConfig, getFtpConfig} = require('../src/project-config');

function tempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-mcp-'));
}

test('加密配置支持多个数据库和 FTP 配置', () => {
    const root = tempProject();
    try {
        saveProjectConfig(root, {
            databases: [
                {name: 'default', host: '127.0.0.1', port: '3306', user: 'root', password: 'db-secret', database: 'app'},
                {name: 'reporting', host: 'db.example.com', port: '3307', user: 'reader', password: 'report-secret', database: 'report'},
            ],
            ftps: [
                {name: 'default', host: 'files.example.com', protocol: 'ftp', username: 'writer', password: 'ftp-secret'},
                {name: 'backup', host: 'backup.example.com', protocol: 'sftp', port: '2222', username: 'backup', password: 'backup-secret'},
            ],
            apifox: {apiKey: 'api-secret', projectId: '42'},
        });
        const raw = fs.readFileSync(path.join(root, ENV_FILE), 'utf8');
        assert.match(raw, /mcp-mysql-apifox-encrypted-config/);
        assert.doesNotMatch(raw, /db-secret|report-secret|ftp-secret|api-secret/);
        assert.equal(getDatabaseConfig(root, 'reporting').database.host, 'db.example.com');
        assert.equal(getDatabaseConfig(root).database.name, 'default');
        assert.equal(getFtpConfig(root, 'backup').ftp.protocol, 'sftp');
        assert.equal(getFtpConfig(root, 'backup').ftp.port, 2222);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('兼容旧版单套 dotenv 配置', () => {
    const root = tempProject();
    try {
        fs.writeFileSync(path.join(root, ENV_FILE), 'DB_HOST=localhost\nDB_PORT=3306\nDB_USER=root\nDB_PASSWORD=old-secret\nDB_NAME=legacy\nFTP_HOST=ftp.local\nFTP_USERNAME=user\n');
        assert.equal(getDatabaseConfig(root).database.database, 'legacy');
        assert.equal(getFtpConfig(root).ftp.host, 'ftp.local');
        assert.equal(loadProjectConfig(root).data.databases.length, 1);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('缺少配置时读取不会创建文件', () => {
    const root = tempProject();
    try {
        const result = loadProjectConfig(root);
        assert.equal(result.created, true);
        assert.match(result.message, /调用 config 工具/);
        assert.equal(fs.existsSync(path.join(root, ENV_FILE)), false);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('初始化命令可启动仅本机可见的配置页面', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    let server;
    try {
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        ({server} = await require('../src/init').startInit([root]));
        const {address, port} = server.address();
        assert.equal(address, '127.0.0.1');
        const html = await new Promise((resolve, reject) => {
            require('node:http').get(`http://127.0.0.1:${port}/`, (response) => {
                let body = '';
                response.on('data', (chunk) => { body += chunk; });
                response.on('end', () => resolve(body));
            }).on('error', reject);
        });
        assert.match(html, /MCP 本地配置/);
        assert.match(html, /加密保存配置/);
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (server) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});
