const childProcess = require('child_process');
const http = require('http');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const {loadProjectConfig, saveProjectConfig} = require('./project-config');
const {FtpManager} = require('./ftp');

function parseArgs(args) {
    const force = args.includes('--force');
    const roots = args.filter((arg) => arg !== '--force');
    if (roots.length > 1) throw new Error('用法：mcp-mysql-apifox config [projectRoot] [--force]');
    return {projectRoot: path.resolve(roots[0] || process.cwd()), force};
}

function openBrowser(url) {
    const options = {detached: true, stdio: 'ignore'};
    if (process.platform === 'win32') childProcess.spawn('cmd', ['/c', 'start', '', url], options).unref();
    else if (process.platform === 'darwin') childProcess.spawn('open', [url], options).unref();
    else childProcess.spawn('xdg-open', [url], options).unref();
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) request.destroy(new Error('请求数据过大。'));
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
}

function requireField(profile, field, label) {
    if (!profile || typeof profile[field] !== 'string' || !profile[field].trim()) throw new Error(`请填写${label}。`);
    return profile[field].trim();
}

function portOf(value, fallback, label) {
    if (value === undefined || value === null || value === '') return fallback;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label}必须是 1 至 65535 的整数。`);
    return port;
}

async function testDatabase(profile) {
    const host = requireField(profile, 'host', '数据库主机');
    const user = requireField(profile, 'user', '数据库用户名');
    const database = requireField(profile, 'database', '数据库名');
    const connection = await mysql.createConnection({
        host,
        port: portOf(profile.port, 3306, '数据库端口'),
        user,
        password: String(profile.password || ''),
        database,
        connectTimeout: 10000,
    });
    try {
        await connection.ping();
        return '数据库连接成功。';
    } finally {
        await connection.end();
    }
}

async function testFtp(profile, projectRoot) {
    const host = requireField(profile, 'host', 'FTP 主机');
    const username = requireField(profile, 'username', 'FTP 用户名');
    const protocol = String(profile.protocol || 'ftp').toLowerCase();
    if (!['ftp', 'ftps', 'sftp'].includes(protocol)) throw new Error('FTP 协议只支持 ftp、ftps 或 sftp。');
    const fallbackPort = protocol === 'sftp' ? 22 : protocol === 'ftps' ? 990 : 21;
    const manager = new FtpManager();
    const connection = `config-test-${crypto.randomBytes(8).toString('hex')}`;
    try {
        const client = await manager.connect(connection, {
            host,
            port: portOf(profile.port, fallbackPort, 'FTP 端口'),
            protocol,
            username,
            password: String(profile.password || ''),
            privateKeyPath: profile.privateKeyPath || undefined,
            passphrase: profile.passphrase || undefined,
            projectRoot,
        });
        const remoteDir = await client.pwd();
        return `FTP 连接成功，当前目录：${remoteDir}`;
    } finally {
        await manager.closeAll();
    }
}

function page(initialData, exists, force, token) {
    const data = JSON.stringify(initialData).replace(/</g, '\\u003c');
    const needsOverwrite = exists && !force;
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP 本地配置</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#1e293b;font:14px system-ui,-apple-system,"Microsoft YaHei",sans-serif}.wrap{max-width:960px;margin:32px auto;padding:0 20px}h1{margin:0 0 8px}.hint{color:#64748b;line-height:1.7}.card{background:#fff;border:1px solid #dbe3ee;border-radius:12px;padding:20px;margin:18px 0;box-shadow:0 2px 10px #0f172a08}h2{font-size:18px;margin:0 0 14px}.profile{border:1px solid #e2e8f0;border-radius:9px;padding:14px;margin:12px 0;background:#fbfdff}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wide{grid-column:span 3}label{display:block;font-size:12px;color:#475569}input,select{display:block;width:100%;margin-top:5px;border:1px solid #cbd5e1;border-radius:6px;padding:9px;background:#fff;color:#0f172a}button{border:0;border-radius:7px;padding:9px 13px;background:#2563eb;color:#fff;cursor:pointer}button.remove{background:#e2e8f0;color:#334155}button.test{background:#0f766e}button.save{font-size:16px;padding:12px 20px}.row{display:flex;gap:9px;align-items:center;margin-top:12px}.notice,.success,.test-result{padding:11px;border-radius:7px;margin-top:12px}.notice{background:#fff7ed;color:#9a3412}.success{background:#ecfdf5;color:#047857}.test-result{background:#f1f5f9;color:#334155}.hidden{display:none}@media(max-width:680px){.grid{grid-template-columns:1fr}.wide{grid-column:span 1}}</style></head>
<body><main class="wrap"><h1>MCP 本地配置</h1><p class="hint">配置仅通过本机回环地址提交。可新增多个数据库和 FTP 配置；每项可在保存前测试连接。</p>${needsOverwrite ? '<p class="notice">已检测到现有配置。保存前需确认覆盖。</p>' : ''}
<form id="form"><section class="card"><h2>数据库</h2><div id="databases"></div><button id="add-database" type="button">新增数据库</button></section><section class="card"><h2>FTP / FTPS / SFTP</h2><div id="ftps"></div><button id="add-ftp" type="button">新增 FTP</button></section><section class="card"><h2>Apifox（可选）</h2><div class="grid"><label class="wide">API Key<input id="apiKey" type="password" autocomplete="off"></label><label class="wide">项目 ID<input id="projectId"></label></div></section>${needsOverwrite ? '<label class="row"><input id="overwrite" type="checkbox">我确认覆盖现有配置</label>' : ''}<p id="result" class="hidden"></p><button id="save" class="save" type="submit">加密保存配置</button></form></main>
<script>
const initial=${data}; const token=${JSON.stringify(token)}; const needsOverwrite=${needsOverwrite};
const databases=document.querySelector('#databases'),ftps=document.querySelector('#ftps'),result=document.querySelector('#result');
function esc(value){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function field(label,key,value,type='text',wide=''){return '<label class="'+wide+'">'+label+'<input type="'+type+'" data-key="'+key+'" value="'+esc(value)+'" autocomplete="off"></label>';}
function profile(kind,item){const isFtp=kind==='ftp';const credentials=isFtp?field('用户名','username',item.username):field('用户名','user',item.user);const password=field('密码','password',item.password,'password');const protocol=isFtp?'<label>协议<select data-key="protocol">'+['ftp','ftps','sftp'].map(value=>'<option value="'+value+'" '+((item.protocol||'ftp')===value?'selected':'')+'>'+value+'</option>').join('')+'</select></label>':'';const extra=isFtp?field('私钥路径（可选）','privateKeyPath',item.privateKeyPath,'text','wide')+field('私钥口令（可选）','passphrase',item.passphrase,'password','wide'):field('数据库名','database',item.database);return '<article class="profile" data-kind="'+kind+'"><div class="grid">'+field('配置名称','name',item.name||'default')+field('主机','host',item.host)+field('端口','port',item.port,'number')+protocol+credentials+password+extra+'</div><div class="row"><button class="test" type="button">测试连接</button><button class="remove" type="button">删除</button></div><p class="test-result hidden"></p></article>';}
function nextName(root,first,base){const names=new Set([...root.querySelectorAll('[data-key="name"]')].map(input=>input.value));if(!names.has(first))return first;let index=2;while(names.has(base+'-'+index))index+=1;return base+'-'+index;}
function addDatabase(item){if(!item)item={name:nextName(databases,'default','database'),port:'3306'};databases.insertAdjacentHTML('beforeend',profile('database',item));}
function addFtp(item){if(!item)item={name:nextName(ftps,'default','ftp'),protocol:'ftp'};ftps.insertAdjacentHTML('beforeend',profile('ftp',item));}
function values(root){return [...root.querySelectorAll('.profile')].map(readProfile);}
function readProfile(element){return Object.fromEntries([...element.querySelectorAll('[data-key]')].map(input=>[input.dataset.key,input.value]));}
function show(node,message,kind){node.className=kind;node.textContent=message;}
async function testProfile(element){const button=element.querySelector('.test');const output=element.querySelector('.test-result');button.disabled=true;show(output,'正在测试连接…','test-result');try{const response=await fetch('/api/test/'+element.dataset.kind+'?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(readProfile(element))});const body=await response.json();show(output,body.message,response.ok?'success':'notice');}catch(error){show(output,error.message,'notice');}finally{button.disabled=false;}}
function bindProfileEvents(root){root.addEventListener('click',event=>{const profile=event.target.closest('.profile');if(!profile)return;if(event.target.closest('.remove'))profile.remove();if(event.target.closest('.test'))testProfile(profile);});}
bindProfileEvents(databases);bindProfileEvents(ftps);document.querySelector('#add-database').addEventListener('click',()=>addDatabase());document.querySelector('#add-ftp').addEventListener('click',()=>addFtp());
(initial.databases||[]).forEach(addDatabase);(initial.ftps||[]).forEach(addFtp);document.querySelector('#apiKey').value=(initial.apifox||{}).apiKey||'';document.querySelector('#projectId').value=(initial.apifox||{}).projectId||'';
document.querySelector('#form').addEventListener('submit',async event=>{event.preventDefault();if(needsOverwrite&&!document.querySelector('#overwrite').checked){show(result,'请先确认覆盖现有配置。','notice');return;}const data={databases:values(databases),ftps:values(ftps),apifox:{apiKey:document.querySelector('#apiKey').value,projectId:document.querySelector('#projectId').value}};try{const response=await fetch('/api/save?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await response.json();show(result,body.message,response.ok?'success':'notice');if(response.ok)document.querySelector('#save').disabled=true;}catch(error){show(result,error.message,'notice');}});
</script></body></html>`;
}

function startConfig(projectRoot, {force = false, onClose, onReady} = {}) {
    const current = loadProjectConfig(projectRoot);
    const exists = !current.created;
    const initialData = current.data;
    const token = crypto.randomBytes(24).toString('hex');
    let server;
    let finished = false;

    return new Promise((resolve, reject) => {
        const complete = (data) => {
            if (finished) return;
            finished = true;
            resolve(data);
            setTimeout(() => server.close(), 250).unref();
        };
        server = http.createServer(async (request, response) => {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (request.method === 'GET' && url.pathname === '/') {
                response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
                response.end(page(initialData, exists, force, token));
                return;
            }
            if (request.method === 'POST' && url.searchParams.get('token') === token && url.pathname === '/api/save') {
                try {
                    const data = JSON.parse(await readBody(request));
                    saveProjectConfig(projectRoot, data);
                    response.writeHead(200, {'content-type': 'application/json; charset=utf-8'});
                    response.end(JSON.stringify({message: '已加密保存配置。'}));
                    complete({projectRoot: current.root});
                } catch (error) {
                    response.writeHead(400, {'content-type': 'application/json; charset=utf-8'});
                    response.end(JSON.stringify({message: error.message}));
                }
                return;
            }
            if (request.method === 'POST' && url.searchParams.get('token') === token && (url.pathname === '/api/test/database' || url.pathname === '/api/test/ftp')) {
                try {
                    const profile = JSON.parse(await readBody(request));
                    const message = url.pathname.endsWith('/database') ? await testDatabase(profile) : await testFtp(profile, current.root);
                    response.writeHead(200, {'content-type': 'application/json; charset=utf-8'});
                    response.end(JSON.stringify({message}));
                } catch (error) {
                    response.writeHead(400, {'content-type': 'application/json; charset=utf-8'});
                    response.end(JSON.stringify({message: `连接失败：${error.message}`}));
                }
                return;
            }
            response.writeHead(404).end();
        });
        server.once('error', reject);
        server.once('close', () => {
            if (typeof onClose === 'function') onClose();
            if (!finished) reject(new Error('配置页面已关闭，尚未保存配置。'));
        });
        server.listen(0, '127.0.0.1', () => {
            const {port} = server.address();
            const url = `http://127.0.0.1:${port}/`;
            console.log(`请在浏览器打开本地配置页面：${url}`);
            openBrowser(url);
            if (typeof onReady === 'function') onReady({server, url});
        });
    });
}

function startInit(args) {
    const {projectRoot, force} = parseArgs(args);
    return startConfig(projectRoot, {force});
}

module.exports = {startConfig, startInit, parseArgs, testDatabase, testFtp};
