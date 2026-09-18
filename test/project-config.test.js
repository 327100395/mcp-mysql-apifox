const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {ENV_FILE, loadProjectConfig, saveProjectConfig, getDatabaseConfig, getFtpConfig} = require('../src/project-config');
const {startConfig, testDatabase, testFtp} = require('../src/init');
const MCPMySQLServer = require('../src/server');

function tempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-mcp-'));
}

function request(url, method = 'GET', body) {
    return new Promise((resolve, reject) => {
        const requestObject = http.request(url, {method, headers: body ? {'content-type': 'application/json'} : {}}, (response) => {
            let text = '';
            response.on('data', (chunk) => { text += chunk; });
            response.on('end', () => resolve({status: response.statusCode, text}));
        });
        requestObject.on('error', reject);
        if (body) requestObject.write(JSON.stringify(body));
        requestObject.end();
    });
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

test('配置页面支持新增、测试连接且保存后才完成', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    let server;
    try {
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        let ready;
        const readyPromise = new Promise((resolve) => { ready = resolve; });
        let resolved = false;
        const completion = startConfig(root, {onReady: ready}).then((value) => { resolved = true; return value; });
        const session = await readyPromise;
        server = session.server;
        const htmlResponse = await request(session.url);
        assert.equal(htmlResponse.status, 200);
        assert.match(htmlResponse.text, /id="add-database"/);
        assert.match(htmlResponse.text, /id="add-ftp"/);
        assert.match(htmlResponse.text, /nextName\(databases,'default','database'\)/);
        assert.match(htmlResponse.text, /测试连接/);
        const script = htmlResponse.text.match(/<script>([\s\S]*)<\/script>/)[1];
        assert.doesNotThrow(() => new Function(script));
        assert.equal(resolved, false);
        const token = htmlResponse.text.match(/const token="([a-f0-9]+)"/)[1];
        const invalidTest = await request(`${session.url}api/test/database?token=${token}`, 'POST', {});
        assert.equal(invalidTest.status, 400);
        assert.match(invalidTest.text, /连接失败/);
        const save = await request(`${session.url}api/save?token=${token}`, 'POST', {databases: [], ftps: [], apifox: {}});
        assert.equal(save.status, 200);
        await completion;
        assert.equal(resolved, true);
        assert.equal(loadProjectConfig(root).created, false);
        await new Promise((resolve) => server.once('close', resolve));
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (server && server.listening) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('MCP config 工具会等待配置保存后再返回', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    let mcp;
    try {
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        mcp = new MCPMySQLServer();
        let settled = false;
        const call = mcp.handleConfig({projectRoot: root}).then((value) => { settled = true; return value; });
        for (let index = 0; index < 20 && !mcp.configServers.size; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(mcp.configServers.size, 1);
        assert.equal(settled, false);
        const server = [...mcp.configServers][0];
        const url = `http://127.0.0.1:${server.address().port}/`;
        const html = await request(url);
        const token = html.text.match(/const token="([a-f0-9]+)"/)[1];
        const save = await request(`${url}api/save?token=${token}`, 'POST', {databases: [], ftps: [], apifox: {}});
        assert.equal(save.status, 200);
        const response = await call;
        assert.match(response.content[0].text, /项目配置已保存/);
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (mcp) await mcp.stop();
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('测试连接在缺少必要字段时不会发起网络连接', async () => {
    const root = tempProject();
    try {
        await assert.rejects(testDatabase({}), /数据库主机/);
        await assert.rejects(testFtp({}, root), /FTP 主机/);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});
