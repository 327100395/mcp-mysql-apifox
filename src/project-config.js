const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILE = '.env.mma';
const ENCRYPTED_FORMAT = 'mcp-mysql-apifox-encrypted-config';
const ENCRYPTED_VERSION = 1;
const CURRENT_ENCRYPTED_VERSION = 2;
const AAD = `${ENCRYPTED_FORMAT}:v${ENCRYPTED_VERSION}`;
const CURRENT_AAD = `${ENCRYPTED_FORMAT}:v${CURRENT_ENCRYPTED_VERSION}`;
// 仅用于读取历史版本配置；新配置由启动参数 -pwd 提供的密码加密。
const CONFIG_MASTER_SECRET = 'mcp-mysql-apifox/config-envelope/v1/5c4e0cf4';
const MASTER_KEY = crypto.createHash('sha256').update(CONFIG_MASTER_SECRET).digest();
const KDF_ITERATIONS = 310000;
let encryptionPassword = '';

function assertProjectRoot(projectRoot) {
    if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
        throw new Error('必须传入 projectRoot（项目根目录的绝对路径）。');
    }
    const root = path.resolve(projectRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`projectRoot 不存在或不是目录: ${root}`);
    }
    return root;
}

function encrypt(value, key, aad = AAD) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(value), cipher.final()]);
    return {iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')};
}

function decrypt(value, key, aad = AAD) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]);
}

function setEncryptionPassword(password) {
    if (typeof password !== 'string' || !password.trim()) throw new Error('必须通过启动参数 -pwd 提供全局 ENV 加密密码。');
    encryptionPassword = password;
}

function hasEncryptionPassword() {
    return Boolean(encryptionPassword);
}

function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, KDF_ITERATIONS, 32, 'sha256');
}

function encryptConfig(data) {
    if (!encryptionPassword) throw new Error('未设置全局 ENV 加密密码。请在启动命令中添加 -pwd <密码> 后再配置。');
    const salt = crypto.randomBytes(16);
    const key = deriveKey(encryptionPassword, salt);
    return JSON.stringify({
        format: ENCRYPTED_FORMAT,
        version: CURRENT_ENCRYPTED_VERSION,
        algorithm: 'aes-256-gcm',
        kdf: 'pbkdf2-sha256',
        iterations: KDF_ITERATIONS,
        salt: salt.toString('base64'),
        payload: encrypt(Buffer.from(JSON.stringify(data), 'utf8'), key, CURRENT_AAD),
    }, null, 2) + '\n';
}

function decryptConfig(raw) {
    let envelope;
    try {
        envelope = JSON.parse(raw);
    } catch {
        throw new Error('项目配置格式无效，请重新执行初始化命令。');
    }
    if (envelope.format !== ENCRYPTED_FORMAT || !envelope.payload) {
        throw new Error('项目配置格式或版本不受支持，请重新执行初始化命令。');
    }
    try {
        if (envelope.version === ENCRYPTED_VERSION && envelope.wrappedKey) {
            const dataKey = decrypt(envelope.wrappedKey, MASTER_KEY);
            return JSON.parse(decrypt(envelope.payload, dataKey).toString('utf8'));
        }
        if (envelope.version === CURRENT_ENCRYPTED_VERSION && envelope.kdf === 'pbkdf2-sha256' && envelope.salt) {
            if (!encryptionPassword) throw new Error('请使用启动参数 -pwd <密码> 提供此 ENV 的加密密码。');
            const key = deriveKey(encryptionPassword, Buffer.from(envelope.salt, 'base64'));
            return JSON.parse(decrypt(envelope.payload, key, CURRENT_AAD).toString('utf8'));
        }
        throw new Error('项目配置格式或版本不受支持，请重新执行初始化命令。');
    } catch (error) {
        if (error.message.includes('启动参数 -pwd')) throw error;
        throw new Error('项目配置无法解密或已损坏；请确认启动参数 -pwd 提供了正确的密码。');
    }
}

function normalizeName(name, type) {
    const value = String(name || '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error(`${type}配置名称只能包含字母、数字、下划线或连字符。`);
    }
    return value;
}

function normalizeProfiles(profiles, type, fields) {
    if (!Array.isArray(profiles)) return [];
    const seen = new Set();
    return profiles.map((profile) => {
        const name = normalizeName(profile && profile.name, type);
        if (seen.has(name)) throw new Error(`${type}配置名称不能重复: ${name}`);
        seen.add(name);
        const result = {name};
        fields.forEach((field) => { result[field] = profile && profile[field] !== undefined ? String(profile[field]) : ''; });
        return result;
    });
}

function normalizeConfig(data) {
    const input = data && typeof data === 'object' ? data : {};
    return {
        databases: normalizeProfiles(input.databases, '数据库', ['host', 'port', 'user', 'password', 'database']),
        ftps: normalizeProfiles(input.ftps, 'FTP', ['host', 'port', 'protocol', 'username', 'password', 'privateKeyPath', 'passphrase']),
        apifox: {
            apiKey: input.apifox && input.apifox.apiKey !== undefined ? String(input.apifox.apiKey) : '',
            projectId: input.apifox && input.apifox.projectId !== undefined ? String(input.apifox.projectId) : '',
        },
    };
}

function legacyConfig(raw) {
    const values = dotenv.parse(raw);
    return normalizeConfig({
        databases: values.DB_HOST || values.DB_PORT || values.DB_USER || values.DB_PASSWORD || values.DB_NAME ? [{
            name: 'default', host: values.DB_HOST, port: values.DB_PORT, user: values.DB_USER,
            password: values.DB_PASSWORD, database: values.DB_NAME,
        }] : [],
        ftps: values.FTP_HOST || values.FTP_PORT || values.FTP_USERNAME || values.FTP_PASSWORD ? [{
            name: 'default', host: values.FTP_HOST, port: values.FTP_PORT, protocol: values.FTP_PROTOCOL,
            username: values.FTP_USERNAME, password: values.FTP_PASSWORD,
            privateKeyPath: values.FTP_PRIVATE_KEY_PATH, passphrase: values.FTP_PASSPHRASE,
        }] : [],
        apifox: {apiKey: values.APIFOX_API_KEY, projectId: values.APIFOX_PROJECT_ID},
    });
}

function loadProjectConfig(projectRoot) {
    const root = assertProjectRoot(projectRoot);
    const envPath = path.join(root, ENV_FILE);
    if (!fs.existsSync(envPath)) {
        return {root, envPath, created: true, data: normalizeConfig(), message: '项目尚未配置。请先调用 config 工具并传入相同的 projectRoot，完成本地配置后重试。'};
    }
    const raw = fs.readFileSync(envPath, 'utf8');
    const data = raw.trimStart().startsWith('{') ? decryptConfig(raw) : legacyConfig(raw);
    return {root, envPath, created: false, data: normalizeConfig(data)};
}

function saveProjectConfig(projectRoot, data) {
    const root = assertProjectRoot(projectRoot);
    const envPath = path.join(root, ENV_FILE);
    const normalized = normalizeConfig(data);
    const temporaryPath = `${envPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, encryptConfig(normalized), {encoding: 'utf8', mode: 0o600});
    fs.renameSync(temporaryPath, envPath);
    try { fs.chmodSync(envPath, 0o600); } catch { /* Windows may not support POSIX permissions. */ }
    return {root, envPath, data: normalized};
}

function findProfile(config, type, name) {
    if (config.created) throw new Error(config.message);
    const profiles = type === '数据库' ? config.data.databases : config.data.ftps;
    const profileName = name || 'default';
    const profile = profiles.find((item) => item.name === profileName);
    if (!profile) {
        const names = profiles.map((item) => item.name).join('、') || '无';
        throw new Error(`未找到${type}配置“${profileName}”，可用配置：${names}。`);
    }
    return profile;
}

function requireValues(profile, keys, serviceName) {
    const missing = keys.filter((key) => !profile[key]);
    if (missing.length) throw new Error(`${serviceName}配置缺少：${missing.join('、')}。请在本机配置页面补全后重试。`);
}

function getDatabaseConfig(projectRoot, profileName = 'default') {
    const config = loadProjectConfig(projectRoot);
    const database = findProfile(config, '数据库', profileName);
    requireValues(database, ['host', 'user', 'password', 'database'], `数据库“${database.name}”`);
    const port = database.port ? Number(database.port) : 3306;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`数据库“${database.name}”的端口必须是 1 至 65535 的整数。`);
    const databaseUrl = new URL('mysql://localhost');
    databaseUrl.hostname = database.host;
    databaseUrl.port = String(port);
    databaseUrl.username = database.user;
    databaseUrl.password = database.password;
    databaseUrl.pathname = `/${database.database}`;
    return {...config, database, dsn: databaseUrl.toString()};
}

function getApifoxConfig(projectRoot) {
    const config = loadProjectConfig(projectRoot);
    if (config.created) throw new Error(config.message);
    requireValues(config.data.apifox, ['apiKey', 'projectId'], 'Apifox');
    return {...config, apiKey: config.data.apifox.apiKey, projectId: config.data.apifox.projectId};
}

function getFtpConfig(projectRoot, profileName = 'default') {
    const config = loadProjectConfig(projectRoot);
    const ftp = findProfile(config, 'FTP', profileName);
    requireValues(ftp, ['host', 'username'], `FTP“${ftp.name}”`);
    const protocol = (ftp.protocol || 'ftp').toLowerCase();
    if (!['ftp', 'ftps', 'sftp'].includes(protocol)) throw new Error(`FTP“${ftp.name}”的协议只支持 ftp、ftps 或 sftp。`);
    const fallbackPort = protocol === 'sftp' ? 22 : protocol === 'ftps' ? 990 : 21;
    const port = ftp.port ? Number(ftp.port) : fallbackPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`FTP“${ftp.name}”的端口必须是 1 至 65535 的整数。`);
    return {...config, ftp: {...ftp, port, protocol, projectRoot: config.root}};
}

module.exports = {ENV_FILE, ENCRYPTED_FORMAT, setEncryptionPassword, hasEncryptionPassword, loadProjectConfig, saveProjectConfig, getDatabaseConfig, getApifoxConfig, getFtpConfig};
