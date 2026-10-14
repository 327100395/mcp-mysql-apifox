const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {ENV_FILE, loadProjectConfig, saveProjectConfig, getDatabaseConfig, getFtpConfig} = require('../src/project-config');
const {startConfig, testDatabase, testFtp} = require('../src/init');
const MCPMySQLServer = require('../src/server');

const originalEnvPwd = process.env.ENV_PWD;
delete process.env.ENV_PWD;
test.after(() => {
    if (originalEnvPwd === undefined) delete process.env.ENV_PWD;
    else process.env.ENV_PWD = originalEnvPwd;
});

function withEnvPassword(password, callback) {
    const previous = process.env.ENV_PWD;
    if (password === undefined) delete process.env.ENV_PWD;
    else process.env.ENV_PWD = password;
    try { return callback(); }
    finally {
        if (previous === undefined) delete process.env.ENV_PWD;
        else process.env.ENV_PWD = previous;
    }
}

function tempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-mcp-'));
}

function encryptLegacyValue(value, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('mcp-mysql-apifox-encrypted-config:v1'));
    const data = Buffer.concat([cipher.update(value), cipher.final()]);
    return {iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')};
}

function legacyEncryptedConfig(data) {
    const masterKey = crypto.createHash('sha256').update('mcp-mysql-apifox/config-envelope/v1/5c4e0cf4').digest();
    const dataKey = crypto.randomBytes(32);
    return JSON.stringify({
        format: 'mcp-mysql-apifox-encrypted-config', version: 1, algorithm: 'aes-256-gcm',
        wrappedKey: encryptLegacyValue(dataKey, masterKey),
        payload: encryptLegacyValue(Buffer.from(JSON.stringify(data)), dataKey),
    });
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

test('中文配置名称可保存并用于读取，仍拒绝重复名称和非法字符', () => {
    const root = tempProject();
    try {
        const data = {
            databases: [{name: '生产库-1', host: 'localhost', user: 'root', password: 'secret', database: 'app'}],
            ftps: [{name: '备份服务器_2', host: 'localhost', username: 'backup', protocol: 'sftp'}],
        };
        saveProjectConfig(root, data);
        assert.equal(getDatabaseConfig(root, '生产库-1').database.name, '生产库-1');
        assert.equal(getFtpConfig(root, '备份服务器_2').ftp.name, '备份服务器_2');
        for (const type of ['databases', 'ftps']) {
            assert.throws(() => saveProjectConfig(root, {[type]: [{name: '重复'}, {name: '重复'}]}), /配置名称不能重复/);
            for (const name of ['', '中文 名称', '../生产库', '配置<script>']) {
                assert.throws(() => saveProjectConfig(root, {[type]: [{name}]}), /配置名称只能包含中文/);
            }
        }
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('MCP list_configs 可发现并调用，只返回数据库和 FTP 配置名称', async () => {
    const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
    const {InMemoryTransport} = require('@modelcontextprotocol/sdk/inMemory.js');
    const root = tempProject();
    const mcp = new MCPMySQLServer();
    const client = new Client({name: 'config-test', version: '1.0.0'});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        await mcp.server.connect(serverTransport);
        await client.connect(clientTransport);
        const {tools} = await client.listTools();
        const tool = tools.find((item) => item.name === 'list_configs');
        assert.ok(tool);
        assert.deepEqual(tool.inputSchema.required, ['projectRoot']);
        for (const name of ['import_openapi', 'download_apis']) {
            assert.equal(tools.some((item) => item.name === name), false);
            const response = await client.callTool({name, arguments: {projectRoot: root}});
            assert.equal(JSON.parse(response.content[0].text).status, 'fail');
        }
        const call = async (args = {projectRoot: root}) => {
            const response = await client.callTool({name: 'list_configs', arguments: args});
            return JSON.parse(response.content[0].text);
        };
        assert.match((await call()).res, /项目尚未配置/);
        assert.equal(fs.existsSync(path.join(root, ENV_FILE)), false);
        assert.equal((await call({})).status, 'fail');
        assert.equal((await call({projectRoot: path.join(root, 'missing')})).status, 'fail');
        withEnvPassword('list-config-password', () => saveProjectConfig(root, {
            databases: [{name: '生产库', host: 'private-db-host', user: 'private-user', password: 'db-secret', database: 'app'}],
            ftps: [{name: '备份服务器', password: 'ftp-secret', passphrase: 'key-secret', privateKeyPath: 'private-key'}],
            apifox: {apiKey: 'api-secret', projectId: 'private-project-id'},
        }));
        assert.equal((await call()).status, 'fail');
        process.env.ENV_PWD = 'list-config-password';
        try {
            assert.deepEqual(await call(), {
                status: 'success',
                res: {databases: ['生产库'], ftps: ['备份服务器']},
            });
            process.env.ENV_PWD = 'wrong-password';
            assert.equal((await call()).status, 'fail');
        } finally {
            delete process.env.ENV_PWD;
        }
        saveProjectConfig(root, {databases: [], ftps: []});
        assert.deepEqual(await call(), {
            status: 'success', res: {databases: [], ftps: []},
        });
        fs.writeFileSync(path.join(root, ENV_FILE), 'DB_HOST=legacy-host\nFTP_HOST=legacy-ftp\n');
        assert.deepEqual((await call()).res, {
            databases: ['default'], ftps: ['default'],
        });
    } finally {
        await client.close();
        await mcp.stop();
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('设置 ENV_PWD 后使用密码加密多个配置', () => {
    const root = tempProject();
    try {
        withEnvPassword('test-global-env-password', () => {
        saveProjectConfig(root, {
            databases: [
                {name: 'default', host: '127.0.0.1', port: '3306', user: 'root', password: 'db-secret', database: 'app'},
                {name: 'reporting', host: 'db.example.com', port: '3307', user: 'reader', password: 'report-secret', database: 'report'},
            ],
            ftps: [
                {name: 'default', host: 'files.example.com', protocol: 'ftp', username: 'writer', password: 'ftp-secret'},
                {name: 'backup', host: 'backup.example.com', protocol: 'sftp', port: '2222', username: 'backup', password: 'backup-secret'},
            ],
        });
        const raw = fs.readFileSync(path.join(root, ENV_FILE), 'utf8');
        assert.match(raw, /mcp-mysql-apifox-encrypted-config/);
        assert.match(raw, /"version": 2/);
        assert.match(raw, /pbkdf2-sha256/);
        assert.doesNotMatch(raw, /db-secret|report-secret|ftp-secret|api-secret/);
        assert.equal(getDatabaseConfig(root, 'reporting').database.host, 'db.example.com');
        assert.equal(getDatabaseConfig(root).database.name, 'default');
        assert.equal(getFtpConfig(root, 'backup').ftp.protocol, 'sftp');
        assert.equal(getFtpConfig(root, 'backup').ftp.port, 2222);
        });
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('未设置 ENV_PWD 时保存为原有加密格式', () => {
    const root = tempProject();
    try {
        saveProjectConfig(root, {databases: [{name: 'default', password: 'old-style-secret'}], ftps: []});
        const raw = fs.readFileSync(path.join(root, ENV_FILE), 'utf8');
        assert.match(raw, /"version": 1/);
        assert.match(raw, /"wrappedKey"/);
        assert.equal(loadProjectConfig(root).data.databases[0].password, 'old-style-secret');
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('旧版加密配置仍可读取，重新保存后按 ENV_PWD 迁移', () => {
    const root = tempProject();
    try {
        withEnvPassword('test-global-env-password', () => {
        const original = {databases: [{name: 'default', host: 'legacy-host', user: 'root', password: 'legacy-secret', database: 'old'}], ftps: [], apifox: {apiKey: 'removed-secret', projectId: '42'}};
        fs.writeFileSync(path.join(root, ENV_FILE), legacyEncryptedConfig(original));
        assert.equal(getDatabaseConfig(root).database.host, 'legacy-host');
        assert.equal(Object.hasOwn(loadProjectConfig(root).data, 'apifox'), false);
        saveProjectConfig(root, loadProjectConfig(root).data);
        const rewritten = fs.readFileSync(path.join(root, ENV_FILE), 'utf8');
        assert.match(rewritten, /"version": 2/);
        assert.equal(getDatabaseConfig(root).database.password, 'legacy-secret');
        });
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

test('无 ENV_PWD 时旧版 dotenv 仍能打开配置页并回显', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    let server;
    try {
        delete process.env.ENV_PWD;
        fs.writeFileSync(path.join(root, ENV_FILE), 'DB_HOST=legacy-host\nDB_USER=legacy-user\nDB_PASSWORD=legacy-secret\nDB_NAME=legacy-db\n');
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        const session = await startConfig(root);
        server = session.server;
        const html = (await request(session.url)).text;
        assert.match(html, /"host":"legacy-host"/);
        assert.match(html, /"password":"legacy-secret"/);
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (server && server.listening) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('ENV_PWD 存在时仍可解密旧加密文件并在配置页回显', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const previousPassword = process.env.ENV_PWD;
    const root = tempProject();
    let server;
    try {
        process.env.ENV_PWD = 'any-current-password';
        fs.writeFileSync(path.join(root, ENV_FILE), legacyEncryptedConfig({
            databases: [{name: 'default', host: 'legacy-encrypted-host', user: 'root', password: 'legacy-encrypted-secret', database: 'legacy'}],
            ftps: [],
        }));
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        const session = await startConfig(root);
        server = session.server;
        const html = (await request(session.url)).text;
        assert.match(html, /"host":"legacy-encrypted-host"/);
        assert.match(html, /"password":"legacy-encrypted-secret"/);
    } finally {
        if (previousPassword === undefined) delete process.env.ENV_PWD;
        else process.env.ENV_PWD = previousPassword;
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (server && server.listening) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('密码加密文件缺少密码时配置页可打开但禁止覆盖', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    let server;
    try {
        withEnvPassword('config-lock-password', () => saveProjectConfig(root, {databases: [], ftps: []}));
        delete process.env.ENV_PWD;
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        const session = await startConfig(root);
        server = session.server;
        const html = (await request(session.url)).text;
        assert.match(html, /设置环境变量 ENV_PWD/);
        assert.match(html, /<form id="form" hidden>/);
        const token = html.match(/const token="([a-f0-9]+)"/)[1];
        const save = await request(`${session.url}api/save?token=${token}`, 'POST', {databases: [], ftps: []});
        assert.equal(save.status, 409);
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (server && server.listening) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('配置页面支持新增、测试连接且保存后自动关闭', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    let server;
    try {
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        const session = await startConfig(root);
        server = session.server;
        const htmlResponse = await request(session.url);
        assert.equal(htmlResponse.status, 200);
        assert.match(htmlResponse.text, /id="add-database"/);
        assert.match(htmlResponse.text, /id="add-ftp"/);
        assert.doesNotMatch(htmlResponse.text, /Apifox|apifox|id="apiKey"|id="projectId"/);
        assert.match(htmlResponse.text, /nextName\(databases,'default','database'\)/);
        assert.match(htmlResponse.text, /测试连接/);
        const script = htmlResponse.text.match(/<script>([\s\S]*)<\/script>/)[1];
        assert.doesNotThrow(() => new Function(script));
        assert.match(htmlResponse.text, /页面会在 1 小时后自动关闭/);
        const token = htmlResponse.text.match(/const token="([a-f0-9]+)"/)[1];
        const invalidTest = await request(`${session.url}api/test/database?token=${token}`, 'POST', {});
        assert.equal(invalidTest.status, 400);
        assert.match(invalidTest.text, /连接失败/);
        const save = await request(`${session.url}api/save?token=${token}`, 'POST', {databases: [], ftps: []});
        assert.equal(save.status, 200);
        assert.equal(loadProjectConfig(root).created, false);
        await new Promise((resolve) => server.once('close', resolve));
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (server && server.listening) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('MCP config 工具会立即返回并保留配置页 1 小时', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    let mcp;
    try {
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        mcp = new MCPMySQLServer();
        const response = await mcp.handleConfig({projectRoot: root});
        assert.match(response.content[0].text, /1 小时后自动关闭/);
        assert.equal(mcp.configServers.size, 1);
        const server = [...mcp.configServers][0];
        const url = `http://127.0.0.1:${server.address().port}/`;
        const html = await request(url);
        const token = html.text.match(/const token="([a-f0-9]+)"/)[1];
        const save = await request(`${url}api/save?token=${token}`, 'POST', {databases: [], ftps: []});
        assert.equal(save.status, 200);
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
        if (mcp) await mcp.stop();
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test('配置页超时后自动关闭', async () => {
    const childProcess = require('node:child_process');
    const originalSpawn = childProcess.spawn;
    const originalLog = console.log;
    const root = tempProject();
    try {
        childProcess.spawn = () => ({unref() {}});
        console.log = () => {};
        const {server} = await startConfig(root, {timeoutMs: 20});
        await new Promise((resolve) => server.once('close', resolve));
        assert.equal(server.listening, false);
    } finally {
        childProcess.spawn = originalSpawn;
        console.log = originalLog;
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
