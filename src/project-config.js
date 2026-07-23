const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILE = '.env.mma';
const TEMPLATE = `# mcp-mysql-apifox configuration\n# Fill in only the services used by this project. This file contains credentials; do not commit it.\nDB_HOST=\nDB_PORT=\nDB_USER=\nDB_PASSWORD=\nDB_NAME=\nAPIFOX_API_KEY=\nAPIFOX_PROJECT_ID=\nFTP_HOST=\nFTP_PORT=\nFTP_PROTOCOL=\nFTP_USERNAME=\nFTP_PASSWORD=\nFTP_PRIVATE_KEY_PATH=\nFTP_PASSPHRASE=\n`;
const TEMPLATE_KEYS = [
    'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
    'APIFOX_API_KEY', 'APIFOX_PROJECT_ID',
    'FTP_HOST', 'FTP_PORT', 'FTP_PROTOCOL', 'FTP_USERNAME', 'FTP_PASSWORD',
    'FTP_PRIVATE_KEY_PATH', 'FTP_PASSPHRASE'
];

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

function loadProjectConfig(projectRoot) {
    const root = assertProjectRoot(projectRoot);
    const envPath = path.join(root, ENV_FILE);

    if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, TEMPLATE, {encoding: 'utf8', flag: 'wx'});
        return {
            root,
            envPath,
            created: true,
            values: {},
            message: `已在项目根目录创建 ${ENV_FILE}。请填写所需配置后重试：DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME、APIFOX_API_KEY、APIFOX_PROJECT_ID，以及 FTP_HOST、FTP_USERNAME。`
        };
    }

    const raw = fs.readFileSync(envPath, 'utf8');
    const values = dotenv.parse(raw);
    const missingKeys = TEMPLATE_KEYS.filter((key) => !Object.hasOwn(values, key));
    if (missingKeys.length) {
        const separator = raw.endsWith('\n') ? '' : '\n';
        fs.appendFileSync(envPath, `${separator}${missingKeys.map((key) => `${key}=`).join('\n')}\n`, 'utf8');
        missingKeys.forEach((key) => { values[key] = ''; });
    }

    return {
        root,
        envPath,
        created: false,
        values,
    };
}

function requireValues(config, keys, serviceName) {
    if (config.created) throw new Error(config.message);
    const missing = keys.filter((key) => !config.values[key]);
    if (missing.length) {
        throw new Error(`${config.envPath} 缺少 ${serviceName} 配置：${missing.join(', ')}。请填写后重试。`);
    }
}

function getDatabaseConfig(projectRoot) {
    const config = loadProjectConfig(projectRoot);
    requireValues(config, ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'], '数据库');
    const port = Number(config.values.DB_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${config.envPath} 中的 DB_PORT 必须是 1 至 65535 的整数。`);
    }

    const databaseUrl = new URL('mysql://localhost');
    databaseUrl.hostname = config.values.DB_HOST;
    databaseUrl.port = String(port);
    databaseUrl.username = config.values.DB_USER;
    databaseUrl.password = config.values.DB_PASSWORD;
    databaseUrl.pathname = `/${config.values.DB_NAME}`;
    return {...config, dsn: databaseUrl.toString()};
}

function getApifoxConfig(projectRoot) {
    const config = loadProjectConfig(projectRoot);
    requireValues(config, ['APIFOX_API_KEY', 'APIFOX_PROJECT_ID'], 'Apifox');
    return {...config, apiKey: config.values.APIFOX_API_KEY, projectId: config.values.APIFOX_PROJECT_ID};
}

function getFtpConfig(projectRoot) {
    const config = loadProjectConfig(projectRoot);
    requireValues(config, ['FTP_HOST', 'FTP_USERNAME'], 'FTP');
    const protocol = (config.values.FTP_PROTOCOL || 'ftp').toLowerCase();
    if (!['ftp', 'ftps', 'sftp'].includes(protocol)) {
        throw new Error('FTP_PROTOCOL 只支持 ftp、ftps 或 sftp。');
    }
    return {
        ...config,
        ftp: {
            host: config.values.FTP_HOST,
            port: Number(config.values.FTP_PORT) || (protocol === 'sftp' ? 22 : protocol === 'ftps' ? 990 : 21),
            protocol,
            username: config.values.FTP_USERNAME,
            password: config.values.FTP_PASSWORD || '',
            privateKeyPath: config.values.FTP_PRIVATE_KEY_PATH || undefined,
            passphrase: config.values.FTP_PASSPHRASE || undefined,
            projectRoot: config.root,
        }
    };
}

module.exports = {ENV_FILE, loadProjectConfig, getDatabaseConfig, getApifoxConfig, getFtpConfig};
