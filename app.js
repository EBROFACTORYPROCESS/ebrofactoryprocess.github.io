// ============================================================
// app.js - 完整核心逻辑
// ============================================================

// ============================
// 1. 常量与状态
// ============================

const REPO_OWNER = '你的用户名';           // ⚠️ 请替换
const REPO_NAME = '你的用户名.github.io';   // ⚠️ 请替换
const DATA_PATH = 'data.json';

let appData = null;          // 当前数据
let currentSha = null;       // 当前 data.json 的 SHA
let isSaving = false;
let currentMode = 'display'; // 'display' | 'edit'
let currentView = 'sequence'; // 'table' | 'sequence'
let searchKeyword = '';
let activeFilters = [];
let collapseState = new Map();

// ============================
// 2. 工具函数
// ============================

function genId() { return Date.now() + '-' + Math.random().toString(36).substr(2, 8); }

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}

function compareSeq(a, b) {
    let pa = a.split('.');
    let pb = b.split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        let na = i < pa.length ? parseInt(pa[i]) : 0;
        let nb = i < pb.length ? parseInt(pb[i]) : 0;
        if (na !== nb) return na - nb;
    }
    return 0;
}

function sortProcesses(procs) {
    return [...procs].sort((a, b) => compareSeq(a.seq, b.seq));
}

// ============================
// 3. 数据规范化
// ============================

function normalizeData(data) {
    for (let sc of data.scenarios) {
        for (let p of sc.processes) {
            if (!p.raci) p.raci = { r: [], a: [], c: [], i: [] };
            if (typeof p.raci.r === 'string') p.raci.r = p.raci.r.split(',').filter(s => s.trim());
            if (typeof p.raci.a === 'string') p.raci.a = p.raci.a.split(',').filter(s => s.trim());
            if (typeof p.raci.c === 'string') p.raci.c = p.raci.c.split(',').filter(s => s.trim());
            if (typeof p.raci.i === 'string') p.raci.i = p.raci.i.split(',').filter(s => s.trim());
            if (!p.system) p.system = { name: '', status: '', responsible: '' };
            if (!p.businessDoc) p.businessDoc = '';
            if (!p.userManual) p.userManual = '';
            if (!p.notes) p.notes = '';
        }
    }
    return data;
}

// ============================
// 4. 获取 Token
// ============================

function getGitHubToken() {
    // 优先从 localStorage 读取
    let token = localStorage.getItem('github_token');
    if (token) return token;
    // 其次从 config.js 全局变量读取
    if (typeof GITHUB_TOKEN !== 'undefined' && GITHUB_TOKEN) {
        return GITHUB_TOKEN;
    }
    return null;
}

// ============================
// 5. 获取当前文件 SHA
// ============================

async function fetchCurrentSha() {
    const token = getGitHubToken();
    if (!token) return null;
    try {
        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            currentSha = data.sha;
            return data.sha;
        }
        return null;
    } catch (e) {
        console.warn('获取 SHA 失败:', e);
        return null;
    }
}

// ============================
// 6. 加载数据（强制不缓存）
// ============================

async function loadData() {
    const loading = document.getElementById('app-loading');
    const root = document.getElementById('app-root');
    
    try {
        loading.style.display = 'flex';
        root.style.display = 'none';
        
        // 强制不缓存：时间戳 + no-store
        const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${DATA_PATH}?t=${Date.now()}`;
        const response = await fetch(url, {
            cache: 'no-store',
            headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                // data.json 不存在，创建默认数据
                appData = getDefaultData();
                await saveDataToGitHub(appData);
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const text = await response.text();
        appData = JSON.parse(text);
        normalizeData(appData);
        
        // 获取 SHA
        await fetchCurrentSha();
        
        // 渲染
        loading.style.display = 'none';
        root.style.display = 'block';
        renderApp();
        
    } catch (error) {
        console.error('加载数据失败:', error);
        loading.innerHTML = `
            <div style="color:#dc2626;font-size:1.5rem;">❌</div>
            <div>加载数据失败</div>
            <div style="font-size:0.8rem;color:#94a3b8;">${error.message}</div>
            <button onclick="loadData()" style="margin-top:1rem;padding:0.5rem 1.5rem;border-radius:2rem;border:1px solid #2a5298;background:white;cursor:pointer;">重新加载</button>
        `;
    }
}

// ============================
// 7. 默认数据
// ============================

function getDefaultData() {
    return {
        departments: ['Sales', 'Production Planning', 'Material Planning', 'Material Handling', 'Purchase', 'Production Execution', 'Parts Quality', 'Vehicle Quality', 'Finance', 'Trade & Compliance'],
        sysNameList: ['SAP', 'LES', 'MES', 'KAPTURE', 'WMS', 'To Be Determined'],
        sysStatusList: [
            { value: 'Operational', color: 'green' },
            { value: 'Completed', color: 'green' },
            { value: 'Offline', color: 'red' },
            { value: 'To Be Implemented', color: 'red' },
            { value: 'Work in Progress', color: 'yellow' }
        ],
        sysRespList: [],
        businessStatuses: [
            { value: 'Not Defined', color: 'red' },
            { value: 'In Progress', color: 'yellow' },
            { value: 'Completed', color: 'green' }
        ],
        scenarios: [
            {
                id: 'default',
                name: 'Manufacturing',
                processes: [
                    {
                        id: genId(),
                        seq: '10',
                        name: '示例流程',
                        description: '这是一个示例流程',
                        raci: { r: ['Sales'], a: [], c: [], i: [] },
                        businessStatus: 'Not Defined',
                        system: { name: 'To Be Determined', status: 'Offline', responsible: '' },
                        businessDoc: '',
                        userManual: '',
                        notes: ''
                    }
                ]
            }
        ],
        currentScenarioId: 'default'
    };
}

// ============================
// 8. 保存数据到 GitHub（带冲突检测）
// ============================

async function saveDataToGitHub(data) {
    if (isSaving) return;
    isSaving = true;
    
    try {
        const token = getGitHubToken();
        if (!token) {
            alert('❌ 请先配置 GitHub Token\n\n点击右上角 ⚙️ 设置 → 输入 Token');
            isSaving = false;
            return;
        }
        
        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
        
        // 第一步：获取最新 SHA
        const getResponse = await fetch(url, {
            headers: { 'Authorization': `token ${token}` }
        });
        
        if (!getResponse.ok) {
            throw new Error('获取文件信息失败');
        }
        
        const fileInfo = await getResponse.json();
        const latestSha = fileInfo.sha;
        
        // 冲突检测
        if (currentSha && currentSha !== latestSha) {
            const confirmRefresh = confirm(
                '⚠️ 数据已被其他人修改！\n\n' +
                '如果你继续保存，会覆盖他人的修改。\n' +
                '建议点击"取消"，刷新页面后重试。\n\n' +
                '是否强制覆盖？'
            );
            if (!confirmRefresh) {
                isSaving = false;
                return;
            }
        }
        
        // 第二步：提交
        const jsonStr = JSON.stringify(data, null, 2);
        const content = btoa(unescape(encodeURIComponent(jsonStr)));
        
        const putResponse = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `更新流程数据 - ${new Date().toLocaleString()}`,
                content: content,
                sha: latestSha
            })
        });
        
        if (!putResponse.ok) {
            const errorData = await putResponse.json();
            throw new Error(errorData.message || '保存失败');
        }
        
        const result = await putResponse.json();
        currentSha = result.content.sha;
        
        alert('✅ 数据已保存到 GitHub！');
        
        // 重新加载最新数据
        await loadData();
        
    } catch (error) {
        console.error('保存失败:', error);
        alert(`❌ 保存失败: ${error.message}`);
    } finally {
        isSaving = false;
    }
}

// ============================
// 9. Token 设置
// ============================

function showTokenSetup() {
    const currentToken = getGitHubToken() || '';
    const newToken = prompt(
        '🔑 请输入 GitHub Personal Access Token\n\n' +
        '获取方式：\n' +
        '1. GitHub Settings → Developer settings\n' +
        '2. Personal access tokens → Tokens (classic)\n' +
        '3. 勾选 repo (全部权限)\n\n' +
        'Token 将保存在浏览器本地。',
        currentToken
    );
    if (newToken !== null && newToken.trim()) {
        localStorage.setItem('github_token', newToken.trim());
        alert('✅ Token 已保存到浏览器本地');
        loadData();
    } else if (newToken === '') {
        localStorage.removeItem('github_token');
        alert('Token 已清除');
    }
}

// 暴露到全局
window.setupToken = showTokenSetup;
window.loadData = loadData;

// ============================
// 10. 渲染应用（占位，实际使用你的渲染逻辑）
// ============================

function renderApp() {
    const root = document.getElementById('app-root');
    
    // 这里需要把你的完整渲染逻辑搬过来
    // 由于篇幅限制，此处先放一个简单示例
    // 实际使用时，你需要将离线 HTML 中所有渲染函数移到这里
    
    root.innerHTML = `
        <div style="padding:2rem;text-align:center;">
            <h1>📊 Business Process Orchestrator</h1>
            <p>数据加载成功！共 ${appData.scenarios.length} 个场景</p>
            <p>当前场景: ${getCurrentScenario()?.name || '无'}</p>
            <p>流程数: ${getCurrentScenario()?.processes?.length || 0}</p>
            <button onclick="showTokenSetup()" style="padding:0.5rem 1.5rem;border-radius:2rem;border:1px solid #2a5298;background:white;cursor:pointer;margin:0.5rem;">🔑 配置 Token</button>
            <button onclick="saveDataToGitHub(appData)" style="padding:0.5rem 1.5rem;border-radius:2rem;background:#2a5298;color:white;border:none;cursor:pointer;margin:0.5rem;">💾 保存到 GitHub</button>
            <div style="margin-top:1rem;text-align:left;max-width:800px;margin-left:auto;margin-right:auto;background:#f8fafc;padding:1rem;border-radius:1rem;border:1px solid #e2e8f0;">
                <h3>📋 流程列表</h3>
                ${getCurrentScenario()?.processes?.map(p => 
                    `<div style="padding:0.3rem 0;border-bottom:1px solid #edf2f7;">${p.seq} - ${p.name} (${p.businessStatus})</div>`
                ).join('') || '无流程'}
            </div>
        </div>
    `;
}

function getCurrentScenario() {
    if (!appData) return null;
    return appData.scenarios.find(s => s.id === appData.currentScenarioId);
}

// ============================
// 11. 页面启动
// ============================

document.addEventListener('DOMContentLoaded', function() {
    // 检查 Token
    const token = getGitHubToken();
    if (!token) {
        const shouldSetup = confirm(
            '🔑 首次使用需要配置 GitHub Token\n\n' +
            'Token 用于读写 data.json 文件。\n' +
            '点击"确定"输入 Token，点击"取消"以只读模式查看。'
        );
        if (shouldSetup) {
            showTokenSetup();
        }
    }
    
    // 加载数据
    loadData();
});
