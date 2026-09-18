const childProcess = require('child_process');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const {loadProjectConfig, saveProjectConfig} = require('./project-config');

function parseArgs(args) {
    const force = args.includes('--force');
    const roots = args.filter((arg) => arg !== '--force');
    if (roots.length > 1) throw new Error('用法：mcp-mysql-apifox init [projectRoot] [--force]');
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

function page(initialData, exists, force, token) {
    const data = JSON.stringify(initialData).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP 本地配置</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#1e293b;font:14px system-ui,-apple-system,"Microsoft YaHei",sans-serif}.wrap{max-width:960px;margin:32px auto;padding:0 20px}h1{margin:0 0 8px}.hint{color:#64748b;line-height:1.7}.card{background:#fff;border:1px solid #dbe3ee;border-radius:12px;padding:20px;margin:18px 0;box-shadow:0 2px 10px #0f172a08}h2{font-size:18px;margin:0 0 14px}.profile{border:1px solid #e2e8f0;border-radius:9px;padding:14px;margin:12px 0;background:#fbfdff}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wide{grid-column:span 3}label{display:block;font-size:12px;color:#475569}input,select{display:block;width:100%;margin-top:5px;border:1px solid #cbd5e1;border-radius:6px;padding:9px;background:#fff;color:#0f172a}button{border:0;border-radius:7px;padding:9px 13px;background:#2563eb;color:#fff;cursor:pointer}button.remove{background:#e2e8f0;color:#334155}button.save{font-size:16px;padding:12px 20px}.row{display:flex;gap:9px;align-items:center;margin-top:12px}.notice{padding:11px;border-radius:7px;background:#fff7ed;color:#9a3412}.success{padding:11px;border-radius:7px;background:#ecfdf5;color:#047857}.hidden{display:none}@media(max-width:680px){.grid{grid-template-columns:1fr}.wide{grid-column:span 1}}</style></head><body><main class="wrap"><h1>MCP 本地配置</h1><p class="hint">配置仅通过本机回环地址提交；保存后会加密写入项目配置文件。数据库与 FTP 可分别新增多套命名配置。</p>${exists && !force ? '<p class="notice">已检测到现有配置。保存前需确认覆盖。</p>' : ''}<form id="form"><section class="card"><h2>数据库</h2><div id="databases"></div><button type="button" onclick="addDatabase()">新增数据库</button></section><section class="card"><h2>FTP / FTPS / SFTP</h2><div id="ftps"></div><button type="button" onclick="addFtp()">新增 FTP</button></section><section class="card"><h2>Apifox（可选）</h2><div class="grid"><label class="wide">API Key<input id="apiKey" type="password" autocomplete="off"></label><label class="wide">项目 ID<input id="projectId"></label></div></section>${exists && !force ? '<label class="row"><input id="overwrite" type="checkbox">我确认覆盖现有配置</label>' : ''}<p id="result" class="hidden"></p><button class="save" type="submit">加密保存配置</button></form></main><script>
const initial=${data}; const token=${JSON.stringify(token)}; const databases=document.querySelector('#databases'),ftps=document.querySelector('#ftps');
function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} function field(label,key,value,type='text',wide=''){return '<label class="'+wide+'">'+label+'<input type="'+type+'" data-key="'+key+'" value="'+esc(value)+'" autocomplete="off"></label>'}
function profile(kind,item){const ftp=kind==='ftp';return '<div class="profile"><div class="grid">'+field('配置名称', 'name', item.name||'default')+field('主机', 'host', item.host)+field('端口', 'port', item.port, 'number')+(ftp?'<label>协议<select data-key="protocol">'+['ftp','ftps','sftp'].map(x=>'<option '+((item.protocol||'ftp')===x?'selected':'')+'>'+x+'</option>').join('')+'</select></label>':field('用户名','user',item.user))+field(ftp?'用户名':'密码',ftp?'username':'password',ftp?item.username:item.password,ftp?'text':'password')+(ftp?field('密码','password',item.password,'password'):field('数据库名','database',item.database))+(ftp?field('私钥路径（可选）','privateKeyPath',item.privateKeyPath,'text','wide')+field('私钥口令（可选）','passphrase',item.passphrase,'password','wide'):'')+'</div><div class="row"><button class="remove" type="button" onclick="this.closest(\'.profile\').remove()">删除</button></div></div>'}
function addDatabase(item={name:'default',port:'3306'}){databases.insertAdjacentHTML('beforeend',profile('database',item))} function addFtp(item={name:'default',protocol:'ftp'}){ftps.insertAdjacentHTML('beforeend',profile('ftp',item))} function values(root){return [...root.querySelectorAll('.profile')].map(p=>Object.fromEntries([...p.querySelectorAll('[data-key]')].map(x=>[x.dataset.key,x.value])))}
(initial.databases||[]).forEach(addDatabase); (initial.ftps||[]).forEach(addFtp); document.querySelector('#apiKey').value=(initial.apifox||{}).apiKey||'';document.querySelector('#projectId').value=(initial.apifox||{}).projectId||'';
document.querySelector('#form').addEventListener('submit',async e=>{e.preventDefault();const result=document.querySelector('#result');if(${exists && !force}&&!document.querySelector('#overwrite').checked){result.className='notice';result.textContent='请先确认覆盖现有配置。';return}const data={databases:values(databases),ftps:values(ftps),apifox:{apiKey:document.querySelector('#apiKey').value,projectId:document.querySelector('#projectId').value}};try{const r=await fetch('/api/save?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await r.json();result.className=r.ok?'success':'notice';result.textContent=body.message;if(r.ok)document.querySelector('.save').disabled=true}catch(err){result.className='notice';result.textContent=err.message}});
</script></body></html>`;
}

function startConfig(projectRoot, {force = false, onClose} = {}) {
    const current = loadProjectConfig(projectRoot);
    const exists = !current.created;
    const initialData = current.data;
    const token = crypto.randomBytes(24).toString('hex');
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (request.method === 'GET' && url.pathname === '/') {
            response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
            response.end(page(initialData, exists, force, token));
            return;
        }
        if (request.method === 'POST' && url.pathname === '/api/save' && url.searchParams.get('token') === token) {
            try {
                const data = JSON.parse(await readBody(request));
                saveProjectConfig(projectRoot, data);
                response.writeHead(200, {'content-type': 'application/json; charset=utf-8'});
                response.end(JSON.stringify({message: '已加密保存。此配置页面将在 1 秒后关闭。'}));
                setTimeout(() => server.close(), 1000).unref();
            } catch (error) {
                response.writeHead(400, {'content-type': 'application/json; charset=utf-8'});
                response.end(JSON.stringify({message: error.message}));
            }
            return;
        }
        response.writeHead(404).end();
    });
    if (typeof onClose === 'function') server.once('close', onClose);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const {port} = server.address();
            const url = `http://127.0.0.1:${port}/`;
            console.log(`请在浏览器打开本地配置页面：${url}`);
            openBrowser(url);
            resolve({server, url});
        });
    });
}

function startInit(args) {
    const {projectRoot, force} = parseArgs(args);
    return startConfig(projectRoot, {force});
}

module.exports = {startConfig, startInit, parseArgs};
