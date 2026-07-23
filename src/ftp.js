const ftp = require('basic-ftp');
const SftpClient = require('ssh2-sftp-client');
const fs = require('fs/promises');
const path = require('path');
const {Readable, Writable} = require('stream');

function remoteJoin(base, child) {
    return path.posix.join(base || '/', child || '');
}

function transferMode(filePath, mode = 'auto') {
    if (mode !== 'auto') return mode;
    return new Set(['.txt', '.html', '.css', '.js', '.json', '.xml', '.csv', '.md', '.yml', '.yaml', '.sql', '.env'])
        .has(path.extname(filePath).toLowerCase()) ? 'ascii' : 'binary';
}

class FtpClient {
    constructor(config) {
        this.config = config;
        this.client = config.protocol === 'sftp' ? new SftpClient() : new ftp.Client();
        this.connected = false;
        this.cwd = '/';
    }
    async connect() {
        if (this.config.protocol === 'sftp') {
            const options = {host: this.config.host, port: this.config.port, username: this.config.username};
            if (this.config.privateKeyPath) {
                options.privateKey = await fs.readFile(this.config.privateKeyPath, 'utf8');
                if (this.config.passphrase) options.passphrase = this.config.passphrase;
            } else options.password = this.config.password;
            await this.client.connect(options);
        } else {
            await this.client.access({
                host: this.config.host, port: this.config.port, user: this.config.username,
                password: this.config.password, secure: this.config.protocol === 'ftps'
            });
            this.cwd = await this.client.pwd();
        }
        this.connected = true;
    }
    async close() { if (this.config.protocol === 'sftp') await this.client.end(); else this.client.close(); this.connected = false; }
    resolve(remotePath) {
        return path.posix.normalize(remotePath && remotePath.startsWith('/')
            ? remotePath
            : remoteJoin(this.cwd, remotePath));
    }
    async pwd() { return this.config.protocol === 'sftp' ? this.cwd : this.client.pwd(); }
    async cd(remotePath) {
        const target = this.resolve(remotePath);
        if (this.config.protocol === 'sftp') {
            const stat = await this.client.stat(target);
            if (!stat.isDirectory) throw new Error(`不是目录: ${target}`);
            this.cwd = target;
        } else await this.client.cd(target);
        this.cwd = target;
    }
    async list(remotePath) {
        const target = remotePath ? this.resolve(remotePath) : await this.pwd();
        const entries = await this.client.list(target);
        return entries.map((item) => this.config.protocol === 'sftp' ? ({
            name: item.name, type: item.type === 'd' ? 'directory' : item.type === '-' ? 'file' : item.type === 'l' ? 'symlink' : 'unknown',
            size: item.size, modifiedDate: new Date(item.modifyTime).toISOString(), permissions: item.rights && `${item.rights.user}${item.rights.group}${item.rights.other}`
        }) : ({
            name: item.name, type: item.isDirectory ? 'directory' : item.isFile ? 'file' : item.isSymbolicLink ? 'symlink' : 'unknown',
            size: item.size, modifiedDate: item.rawModifiedAt || item.modifiedAt?.toISOString() || '', permissions: item.permissions && `${item.permissions.user}${item.permissions.group}${item.permissions.world}`
        }));
    }
    async upload(localPath, remotePath, mode) {
        const target = this.resolve(remotePath);
        if (this.config.protocol === 'sftp') return this.client.put(localPath, target);
        this.client.ftp.dataType = transferMode(localPath, mode) === 'ascii' ? 'ascii' : undefined;
        return this.client.uploadFrom(localPath, target);
    }
    async download(remotePath, localPath) { await fs.mkdir(path.dirname(localPath), {recursive: true}); return this.config.protocol === 'sftp' ? this.client.get(this.resolve(remotePath), localPath) : this.client.downloadTo(localPath, this.resolve(remotePath)); }
    async remove(remotePath) { return this.config.protocol === 'sftp' ? this.client.delete(this.resolve(remotePath)) : this.client.remove(this.resolve(remotePath)); }
    async rename(from, to) { return this.client.rename(this.resolve(from), this.resolve(to)); }
    async mkdir(remotePath, recursive = false) { const target = this.resolve(remotePath); return this.config.protocol === 'sftp' ? this.client.mkdir(target, recursive) : recursive ? this.client.ensureDir(target) : this.client.send(`MKD ${target}`); }
    async rmdir(remotePath, recursive = false) { const target = this.resolve(remotePath); return this.config.protocol === 'sftp' ? this.client.rmdir(target, recursive) : recursive ? this.client.removeDir(target) : this.client.send(`RMD ${target}`); }
    async stat(remotePath) {
        const target = this.resolve(remotePath);
        if (this.config.protocol === 'sftp') { const s = await this.client.stat(target); return {name: path.posix.basename(target), type: s.isDirectory ? 'directory' : s.isFile ? 'file' : 'unknown', size: s.size, modifiedDate: new Date(s.modifyTime).toISOString()}; }
        const item = (await this.list(path.posix.dirname(target))).find((entry) => entry.name === path.posix.basename(target));
        if (!item) throw new Error(`找不到远程路径: ${target}`);
        return item;
    }
    async exists(remotePath) { try { await this.stat(remotePath); return true; } catch { return false; } }
    async read(remotePath) {
        if (this.config.protocol === 'sftp') { const data = await this.client.get(this.resolve(remotePath)); return Buffer.isBuffer(data) ? data.toString('utf8') : ''; }
        const chunks = []; const output = new Writable({write(chunk, enc, done) { chunks.push(Buffer.from(chunk)); done(); }});
        await this.client.downloadTo(output, this.resolve(remotePath)); return Buffer.concat(chunks).toString('utf8');
    }
    async write(remotePath, content, append = false) {
        const target = this.resolve(remotePath); const data = Buffer.from(content, 'utf8');
        if (this.config.protocol === 'sftp') { if (append) content = (await this.read(remotePath).catch(() => '')) + content; return this.client.put(Buffer.from(content, 'utf8'), target); }
        return append ? this.client.appendFrom(Readable.from(data), target) : this.client.uploadFrom(Readable.from(data), target);
    }
    async chmod(remotePath, mode) { const target = this.resolve(remotePath); return this.config.protocol === 'sftp' ? this.client.chmod(target, parseInt(String(mode), 8)) : this.client.send(`SITE CHMOD ${mode} ${target}`); }
}

class FtpManager {
    constructor() { this.connections = new Map(); }
    async connect(name, config) { if (this.connections.has(name)) await this.disconnect(name); const client = new FtpClient(config); await client.connect(); this.connections.set(name, client); return client; }
    get(name) { const client = this.connections.get(name); if (!client || !client.connected) throw new Error(`FTP 连接 ${name} 不存在或已断开，请先调用 ftp_connect。`); return client; }
    async disconnect(name) { const client = this.connections.get(name); if (!client) throw new Error(`FTP 连接 ${name} 不存在。`); await client.close(); this.connections.delete(name); }
    list() { return [...this.connections.entries()].map(([name, client]) => ({name, host: client.config.host, protocol: client.config.protocol, cwd: client.cwd})); }
    async closeAll() { await Promise.allSettled([...this.connections.keys()].map((name) => this.disconnect(name))); }
}

module.exports = {FtpManager};
