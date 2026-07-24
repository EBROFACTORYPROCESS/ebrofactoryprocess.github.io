// ============================================================
// app.js - Complete Core Logic
// ============================================================

console.log('✅ app.js loaded');

// ============================
// 1. Constants & State
// ============================

const REPO_OWNER = 'ebrofactoryprocess';
const REPO_NAME = 'ebrofactoryprocess.github.io';
const DATA_PATH = 'data.json';

let appData = null;
let currentSha = null;
let isSaving = false;
let currentMode = 'display';
let currentView = 'sequence';
let searchKeyword = '';
let activeFilters = [];
let collapseState = new Map();
let pendingDeleteCallback = null;
let pendingAddSubCallback = null;
let pendingImportCallback = null;
let currentEditingProcess = null;
let lastSnapshot = null;
let eventsBound = false;

// ============================
// 2. Column Definitions
// ============================

const columnPaths = {
    seq: p => p.seq,
    name: p => p.name,
    description: p => p.description || '',
    r: p => p.raci.r.join(', '),
    a: p => p.raci.a.join(', '),
    c: p => p.raci.c.join(', '),
    i: p => p.raci.i.join(', '),
    businessStatus: p => p.businessStatus,
    sysName: p => p.system.name,
    sysStatus: p => p.system.status,
    sysResp: p => p.system.responsible,
    businessDoc: p => p.businessDoc || '',
    userManual: p => p.userManual || '',
    notes: p => p.notes || ''
};

const columnNames = {
    seq: 'Seq',
    name: 'Process Name',
    description: 'Description',
    r: 'Responsible (R)',
    a: 'Accountable (A)',
    c: 'Consulted (C)',
    i: 'Informed (I)',
    businessStatus: 'Business Status',
    sysName: 'System Name',
    sysStatus: 'System Status',
    sysResp: 'System Responsible',
    businessDoc: 'Business Doc',
    userManual: 'User Manual',
    notes: 'Notes'
};

// ============================
// 3. Utility Functions
// ============================

function genId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 8);
}

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
    // Guard against undefined or null
    const strA = String(a || '0');
    const strB = String(b || '0');
    
    let pa = strA.split('.');
    let pb = strB.split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        let na = i < pa.length ? parseInt(pa[i]) : 0;
        let nb = i < pb.length ? parseInt(pb[i]) : 0;
        if (isNaN(na)) na = 0;
        if (isNaN(nb)) nb = 0;
        if (na !== nb) return na - nb;
    }
    return 0;
}
function sortProcesses(procs) {
    // Guard against invalid input
    if (!procs || !Array.isArray(procs)) {
        console.warn('⚠️ sortProcesses: input is not an array, returning empty array');
        return [];
    }
    
    // Filter out invalid processes and sort
    const validProcs = procs.filter(p => p && typeof p === 'object' && p.seq !== undefined);
    return [...validProcs].sort((a, b) => {
        // Guard against missing seq
        const seqA = a.seq || '0';
        const seqB = b.seq || '0';
        return compareSeq(String(seqA), String(seqB));
    });
}

function isSeqUnique(scenario, seq, excludeId) {
    return !scenario.processes.some(p => p.seq === seq && p.id !== excludeId);
}

// ============================
// 4. Data Normalization
// ============================

function normalizeData(data) {
    console.log('📊 normalizeData called');
    
    // Ensure data is an object
    if (!data || typeof data !== 'object') {
        console.warn('⚠️ normalizeData: data is not an object, creating default');
        return getDefaultData();
    }
    
    // Ensure scenarios exists and is an array
    if (!data.scenarios || !Array.isArray(data.scenarios)) {
        console.warn('⚠️ normalizeData: scenarios is not an array, creating default');
        data.scenarios = [{
            id: 'default',
            name: 'Manufacturing',
            processes: []
        }];
        data.currentScenarioId = 'default';
    }
    
    // Process each scenario
    for (let sc of data.scenarios) {
        // Skip if scenario is invalid
        if (!sc || typeof sc !== 'object') {
            console.warn('⚠️ Skipping invalid scenario:', sc);
            continue;
        }
        
        // Ensure processes exists and is an array
        if (!sc.processes || !Array.isArray(sc.processes)) {
            console.warn('⚠️ Scenario missing processes array, creating empty:', sc.id || 'unknown');
            sc.processes = [];
        }
        
        // Normalize each process
        for (let p of sc.processes) {
            if (!p || typeof p !== 'object') {
                console.warn('⚠️ Skipping invalid process:', p);
                continue;
            }
            
            // Ensure raci exists
            if (!p.raci || typeof p.raci !== 'object') {
                p.raci = { r: [], a: [], c: [], i: [] };
            }
            
            // Convert raci strings to arrays if needed
            if (typeof p.raci.r === 'string') {
                p.raci.r = p.raci.r.split(',').filter(s => s && s.trim());
            }
            if (typeof p.raci.a === 'string') {
                p.raci.a = p.raci.a.split(',').filter(s => s && s.trim());
            }
            if (typeof p.raci.c === 'string') {
                p.raci.c = p.raci.c.split(',').filter(s => s && s.trim());
            }
            if (typeof p.raci.i === 'string') {
                p.raci.i = p.raci.i.split(',').filter(s => s && s.trim());
            }
            
            // Ensure raci arrays exist
            if (!Array.isArray(p.raci.r)) p.raci.r = [];
            if (!Array.isArray(p.raci.a)) p.raci.a = [];
            if (!Array.isArray(p.raci.c)) p.raci.c = [];
            if (!Array.isArray(p.raci.i)) p.raci.i = [];
            
            // Ensure system exists
            if (!p.system || typeof p.system !== 'object') {
                p.system = { name: '', status: '', responsible: '' };
            }
            
            // Ensure all required fields exist
            if (!p.businessDoc) p.businessDoc = '';
            if (!p.userManual) p.userManual = '';
            if (!p.notes) p.notes = '';
            if (!p.id) p.id = genId();
            
            // Ensure seq is a string
            if (p.seq !== undefined && p.seq !== null) {
                p.seq = String(p.seq);
            } else {
                p.seq = '0';
            }
        }
        
        // Sort processes after normalization
        sc.processes = sortProcesses(sc.processes);
    }
    
    // Ensure currentScenarioId is valid
    if (!data.currentScenarioId && data.scenarios.length > 0) {
        data.currentScenarioId = data.scenarios[0].id || 'default';
    }
    
    // Ensure master data exists
    if (!data.departments || !Array.isArray(data.departments)) {
        data.departments = ['Sales', 'Production Planning', 'Material Planning', 'Material Handling', 'Purchase', 'Production Execution', 'Parts Quality', 'Vehicle Quality', 'Finance', 'Trade & Compliance'];
    }
    
    if (!data.sysNameList || !Array.isArray(data.sysNameList)) {
        data.sysNameList = ['SAP', 'LES', 'MES', 'KAPTURE', 'WMS', 'To Be Determined'];
    }
    
    if (!data.sysStatusList || !Array.isArray(data.sysStatusList)) {
        data.sysStatusList = [
            { value: 'Operational', color: 'green' },
            { value: 'Completed', color: 'green' },
            { value: 'Offline', color: 'red' },
            { value: 'To Be Implemented', color: 'red' },
            { value: 'Work in Progress', color: 'yellow' }
        ];
    }
    
    if (!data.businessStatuses || !Array.isArray(data.businessStatuses)) {
        data.businessStatuses = [
            { value: 'Not Defined', color: 'red' },
            { value: 'In Progress', color: 'yellow' },
            { value: 'Completed', color: 'green' }
        ];
    }
    
    if (!data.sysRespList || !Array.isArray(data.sysRespList)) {
        data.sysRespList = [];
    }
    
    console.log('✅ Data normalized successfully, scenarios:', data.scenarios.length);
    return data;
}
// ============================
// 5. Token Management
// ============================

function getGitHubToken() {
    return localStorage.getItem('github_token');
}

function setGitHubToken(token) {
    if (token && token.trim()) {
        localStorage.setItem('github_token', token.trim());
        return true;
    }
    return false;
}

function clearGitHubToken() {
    localStorage.removeItem('github_token');
}

function showTokenSetup() {
    const currentToken = getGitHubToken() || '';
    const newToken = prompt(
        '🔑 Enter your GitHub Personal Access Token\n\n' +
        'How to get one:\n' +
        '1. GitHub Settings → Developer settings\n' +
        '2. Personal access tokens → Tokens (classic)\n' +
        '3. Check "repo" (all permissions)\n\n' +
        'The token will be saved in your browser.',
        currentToken
    );
    if (newToken !== null && newToken.trim()) {
        setGitHubToken(newToken);
        alert('✅ Token saved to browser local storage');
        loadData();
    } else if (newToken === '') {
        clearGitHubToken();
        alert('Token cleared');
    }
}

// ============================
// 6. Snapshot Management
// ============================

function loadSnapshot() {
    try {
        const saved = localStorage.getItem('bpo_snapshot');
        if (saved) {
            lastSnapshot = JSON.parse(saved);
            return true;
        }
    } catch (e) {
        console.warn('Failed to load snapshot:', e);
    }
    return false;
}

function saveSnapshot(data) {
    try {
        localStorage.setItem('bpo_snapshot', JSON.stringify(data));
        lastSnapshot = JSON.parse(JSON.stringify(data));
        return true;
    } catch (e) {
        console.warn('Failed to save snapshot:', e);
        return false;
    }
}

function initializeSnapshot(data) {
    if (!loadSnapshot()) {
        // Create a deep clone of the data as baseline
        lastSnapshot = JSON.parse(JSON.stringify(data));
        saveSnapshot(lastSnapshot);
        console.log('📸 Initial snapshot created');
        return true;
    }
    return true;
}


function generateDiff(oldData, newData) {
    if (typeof jsondiffpatch !== 'undefined' && jsondiffpatch.diff) {
        try {
            const delta = jsondiffpatch.diff(oldData, newData);
            return delta || null;
        } catch (e) {
            console.warn('jsondiffpatch diff failed, using simple diff:', e.message);
            return generateSimpleDiff(oldData, newData);
        }
    }
    return generateSimpleDiff(oldData, newData);
}

function generateSimpleDiff(oldData, newData) {
    const diff = {};
    let hasChanges = false;
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    for (const key of allKeys) {
        const oldVal = JSON.stringify(oldData[key]);
        const newVal = JSON.stringify(newData[key]);
        if (oldVal !== newVal) {
            diff[key] = newData[key];
            hasChanges = true;
        }
    }
    return hasChanges ? diff : null;
}

// ============================
// Save data to GitHub (with Gist for large data)
// ============================

async function saveDataToGitHub(data) {
    if (isSaving) return;
    isSaving = true;

    const saveBtn = document.getElementById('saveDataBtn');
    if (saveBtn) {
        saveBtn.textContent = '⏳ Saving...';
        saveBtn.disabled = true;
    }

    try {
        // Get token
        let token = getGitHubToken();
        if (!token) {
            token = prompt(
                '🔑 A GitHub Token is required to save data\n\n' +
                'Please enter your GitHub Token. It will be saved in your browser.'
            );
            if (token && token.trim()) {
                setGitHubToken(token);
                alert('✅ Token saved to browser local storage');
            } else {
                throw new Error('No Token provided, save cancelled');
            }
        }

        // Clean token
        token = token.trim();

        // ✅ IMPORTANT: Generate diff correctly
        let diff = null;
        
        // If lastSnapshot is null or empty, use a deep clone of current data as baseline
        if (!lastSnapshot) {
            console.log('📸 No snapshot found, creating baseline...');
            lastSnapshot = JSON.parse(JSON.stringify(data));
            saveSnapshot(lastSnapshot);
            alert('ℹ️ Baseline snapshot created. Please make another change to save.');
            isSaving = false;
            if (saveBtn) {
                saveBtn.textContent = '💾 Save to GitHub';
                saveBtn.disabled = false;
            }
            return;
        }

        // Generate diff using jsondiffpatch
        try {
            if (typeof jsondiffpatch !== 'undefined' && jsondiffpatch.diff) {
                diff = jsondiffpatch.diff(lastSnapshot, data);
                console.log('📊 Diff generated with jsondiffpatch');
            } else {
                // Fallback: simple diff
                diff = generateSimpleDiff(lastSnapshot, data);
                console.log('📊 Diff generated with simple fallback');
            }
        } catch (e) {
            console.error('Diff generation failed:', e);
            diff = generateSimpleDiff(lastSnapshot, data);
        }

        // If no changes detected
        if (!diff) {
            alert('ℹ️ No changes detected. Nothing to save.');
            isSaving = false;
            if (saveBtn) {
                saveBtn.textContent = '💾 Save to GitHub';
                saveBtn.disabled = false;
            }
            return;
        }

        const jsonStr = JSON.stringify(diff);
        console.log(`📊 Diff size: ${jsonStr.length} bytes (${(jsonStr.length/1024).toFixed(1)} KB)`);

        // Determine if we need Gist (data > 30KB for safety, under 64KB limit)
        const useGist = jsonStr.length > 30000;
        let gistId = null;
        let payloadData = jsonStr;
        let payloadType = 'diff';

        if (useGist) {
            console.log('📤 Data is large, uploading to Gist...');
            
            const gistPayload = {
                description: `BPO diff - ${new Date().toISOString()}`,
                public: false,
                files: {
                    'diff.json': {
                        content: jsonStr
                    }
                }
            };

            try {
                const gistResponse = await fetch('https://api.github.com/gists', {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    body: JSON.stringify(gistPayload)
                });

                if (!gistResponse.ok) {
                    const errorData = await gistResponse.json();
                    console.error('Gist API error:', errorData);
                    // If Gist fails, fallback to direct payload (might be too large)
                    console.log('⚠️ Gist creation failed, falling back to direct payload');
                } else {
                    const gistData = await gistResponse.json();
                    gistId = gistData.id;
                    payloadType = 'gist';
                    payloadData = ''; // Don't send data directly
                    console.log(`✅ Gist created: ${gistId}`);
                    
                    // Verify the Gist was created successfully
                    const verifyResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
                        headers: {
                            'Authorization': `token ${token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    if (!verifyResponse.ok) {
                        console.warn('⚠️ Gist verification failed, but continuing...');
                    }
                }
            } catch (gistError) {
                console.error('Gist creation failed:', gistError);
                // Fallback: send data directly
                console.log('⚠️ Falling back to direct payload');
                payloadType = 'diff';
                payloadData = jsonStr;
                gistId = null;
            }
        }

        // ✅ Build payload correctly
        const payload = {
            event_type: 'update-data',
            client_payload: {
                type: payloadType,
                gist_id: gistId || '',
                data: payloadData,
                snapshot_id: Date.now()
            }
        };

        console.log(`📤 Sending payload with type: ${payloadType}, gist_id: ${gistId || 'none'}`);
        console.log(`📤 Payload data length: ${payloadData.length} bytes`);

        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Dispatch API error:', errorData);
            if (response.status === 401) {
                clearGitHubToken();
                throw new Error('Token is invalid or expired. Please re-enter your Token.');
            }
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        // ✅ Save snapshot only after successful save
        saveSnapshot(data);
        console.log('✅ Snapshot updated');

        const sizeMsg = useGist && gistId 
            ? `📤 Uploaded to Gist (temporary)\n   Gist ID: ${gistId}`
            : `📊 Size: ${(jsonStr.length/1024).toFixed(1)} KB`;
        
        alert(`✅ Changes saved successfully!\n\n${sizeMsg}\n\nGitHub Actions is applying the changes.`);

        setTimeout(() => {
            if (confirm('Refresh page to see the latest data?')) {
                location.reload();
            }
        }, 10000);

    } catch (error) {
        console.error('Save failed:', error);
        alert(`❌ Save failed: ${error.message}`);
    } finally {
        isSaving = false;
        if (saveBtn) {
            saveBtn.textContent = '💾 Save to GitHub';
            saveBtn.disabled = false;
        }
    }
}
// ============================
// 8. Load Data
// ============================

async function loadData() {
    console.log('📊 loadData() called');
    const loading = document.getElementById('app-loading');
    const root = document.getElementById('app-root');

    try {
        if (loading) loading.style.display = 'flex';
        if (root) root.style.display = 'none';

        const url = `data.json?t=${Date.now()}`;
        const response = await fetch(url, {
            cache: 'no-store',
            headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.log('📄 data.json not found, creating default');
                appData = getDefaultData();
                normalizeData(appData);
                initializeSnapshot(appData);
                renderApp();
                if (loading) loading.style.display = 'none';
                if (root) root.style.display = 'block';
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        console.log('📄 Data loaded, length:', text.length);
        
        // Parse and normalize
        let rawData = JSON.parse(text);
        console.log('📊 Raw data parsed, scenarios:', rawData.scenarios?.length || 0);
        
        // ✅ Normalize with robust function
        appData = normalizeData(rawData);
        
        // ✅ Initialize snapshot
        initializeSnapshot(appData);

        if (loading) loading.style.display = 'none';
        if (root) root.style.display = 'block';
        renderApp();
        console.log('✅ Data loaded and rendered successfully');

    } catch (error) {
        console.error('Failed to load data:', error);
        if (loading) {
            loading.innerHTML = `
                <div style="color:#dc2626;font-size:1.5rem;">❌</div>
                <div>Failed to load data</div>
                <div style="font-size:0.8rem;color:#94a3b8;">${escapeHtml(error.message)}</div>
                <button onclick="loadData()" style="margin-top:1rem;padding:0.5rem 1.5rem;border-radius:2rem;border:1px solid #2a5298;background:white;cursor:pointer;">Retry</button>
            `;
        }
    }
}

// ============================
// 9. Default Data
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
                        name: 'Sample Process',
                        description: 'This is a sample process. Please import your data.',
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
// 10. Get Current Scenario
// ============================

function getCurrentScenario() {
    if (!appData) return null;
    return appData.scenarios.find(s => s.id === appData.currentScenarioId);
}

function getScenarioById(id) {
    if (!appData) return null;
    return appData.scenarios.find(s => s.id === id);
}

// ============================
// 11. Filter and Search
// ============================

function matchesFilters(proc) {
    if (activeFilters.length > 0) {
        for (let f of activeFilters) {
            if (f.values.length === 0) continue;
            let val = columnPaths[f.column](proc);
            let match = f.values.some(v => val.toLowerCase().includes(v.toLowerCase()));
            if (!match) return false;
        }
        return true;
    } else {
        if (!searchKeyword.trim()) return true;
        let kw = searchKeyword.toLowerCase();
        return columnPaths.seq(proc).toLowerCase().includes(kw) ||
            columnPaths.name(proc).toLowerCase().includes(kw) ||
            columnPaths.description(proc).toLowerCase().includes(kw) ||
            columnPaths.r(proc).toLowerCase().includes(kw) ||
            columnPaths.businessStatus(proc).toLowerCase().includes(kw) ||
            columnPaths.sysName(proc).toLowerCase().includes(kw) ||
            columnPaths.sysStatus(proc).toLowerCase().includes(kw);
    }
}

function getProcessesForDisplay(scenario) {
    let all = scenario.processes;
    if (activeFilters.length > 0) {
        return sortProcesses(all.filter(p => matchesFilters(p)));
    } else {
        let matching = all.filter(p => matchesFilters(p));
        if (!searchKeyword.trim()) return sortProcesses(all);
        let ancestorIds = new Set();
        for (let p of matching) {
            ancestorIds.add(p.id);
            let parts = p.seq.split('.');
            for (let i = 1; i < parts.length; i++) {
                let parentSeq = parts.slice(0, i).join('.');
                let parent = all.find(pp => pp.seq === parentSeq);
                if (parent) ancestorIds.add(parent.id);
            }
        }
        return sortProcesses(all.filter(p => ancestorIds.has(p.id)));
    }
}

function buildTree(processes) {
    let nodeMap = new Map();
    for (let p of processes) nodeMap.set(p.seq, { process: p, children: [] });
    for (let p of processes) {
        if (p.seq.includes('.')) {
            let parentSeq = p.seq.substring(0, p.seq.lastIndexOf('.'));
            if (nodeMap.has(parentSeq)) nodeMap.get(parentSeq).children.push(p);
        }
    }
    let roots = Array.from(nodeMap.values()).filter(n => !n.process.seq.includes('.'));
    roots.sort((a, b) => compareSeq(a.process.seq, b.process.seq));
    for (let root of roots) {
        root.children.sort((a, b) => compareSeq(a.seq, b.seq));
    }
    return { nodeMap, roots };
}

function getParentProcess(proc, scenario) {
    if (!proc.seq.includes('.')) return null;
    let parentSeq = proc.seq.substring(0, proc.seq.lastIndexOf('.'));
    return scenario.processes.find(p => p.seq === parentSeq);
}

function toggleCollapse(id) {
    if (activeFilters.length > 0 || searchKeyword || currentMode === 'edit') return;
    collapseState.set(id, !(collapseState.get(id) || false));
    renderCurrentView();
}

function collapseAllParents() {
    if (activeFilters.length > 0 || searchKeyword || currentMode === 'edit') return;
    const sc = getCurrentScenario();
    if (sc) {
        for (let p of sc.processes) {
            if (!p.seq.includes('.')) collapseState.set(p.id, true);
        }
    }
    renderCurrentView();
}

function expandAllParents() {
    if (activeFilters.length > 0 || searchKeyword || currentMode === 'edit') return;
    const sc = getCurrentScenario();
    if (sc) {
        for (let p of sc.processes) {
            if (!p.seq.includes('.')) collapseState.set(p.id, false);
        }
    }
    renderCurrentView();
}

// ============================
// 12. Render: Table View
// ============================

function renderTable() {
    let tbody = document.getElementById('tableBody');
    let noResult = document.getElementById('noResultMsg');
    let scenario = getCurrentScenario();
    if (!scenario) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="8">No scenario</td></tr>';
        if (noResult) noResult.style.display = 'none';
        return;
    }
    let processes = getProcessesForDisplay(scenario);
    if (processes.length === 0) {
        if (tbody) tbody.innerHTML = '';
        if (noResult) noResult.style.display = 'block';
        return;
    }
    if (noResult) noResult.style.display = 'none';

    let isEdit = (currentMode === 'edit');
    let actionsHeader = document.getElementById('actionsHeader');
    if (actionsHeader) actionsHeader.style.display = isEdit ? 'table-cell' : 'none';

    if (!tbody) return;
    tbody.innerHTML = '';

    for (let proc of processes) {
        let row = tbody.insertRow();

        let tdCollapse = row.insertCell();
        let isParent = !proc.seq.includes('.');
        let hasChildren = isParent && scenario.processes.some(p => p.seq.startsWith(proc.seq + '.'));
        if (isParent && hasChildren && activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit') {
            let collapsed = collapseState.get(proc.id) || false;
            let btn = document.createElement('button');
            btn.textContent = collapsed ? '▶' : '▼';
            btn.className = 'collapse-row-btn';
            btn.onclick = (e) => { e.stopPropagation(); toggleCollapse(proc.id); };
            tdCollapse.appendChild(btn);
        }

        let tdSeq = row.insertCell();
        if (isEdit) {
            let inp = document.createElement('input');
            inp.type = 'text';
            inp.value = proc.seq;
            inp.className = 'seq-input';
            inp.addEventListener('change', (e) => {
                let ns = e.target.value.trim();
                if (ns && isSeqUnique(scenario, ns, proc.id)) {
                    proc.seq = ns;
                    renderCurrentView();
                } else if (ns) alert('Sequence exists');
            });
            tdSeq.appendChild(inp);
        } else {
            tdSeq.innerText = proc.seq;
        }

        let tdName = row.insertCell();
        let span = document.createElement('span');
        span.className = 'clickable-name';
        span.innerText = proc.name;
        span.onclick = () => openProcessDetail(proc.id);
        tdName.appendChild(span);

        let tdR = row.insertCell();
        tdR.innerHTML = proc.raci.r.map(d => `<span class="raci-tag">${escapeHtml(d)}</span>`).join('');

        let tdStatus = row.insertCell();
        if (isEdit) {
            let sel = document.createElement('select');
            sel.className = 'status-select';
            appData.businessStatuses.forEach(s => {
                let op = document.createElement('option');
                op.value = s.value;
                op.textContent = s.value;
                if (s.value === proc.businessStatus) op.selected = true;
                sel.appendChild(op);
            });
            sel.onchange = () => { proc.businessStatus = sel.value; renderCurrentView(); };
            tdStatus.appendChild(sel);
        } else {
            let color = appData.businessStatuses.find(s => s.value === proc.businessStatus)?.color || 'default';
            tdStatus.innerHTML = `<span class="status-badge ${color}">🏢 ${escapeHtml(proc.businessStatus)}</span>`;
        }

        let tdSysName = row.insertCell();
        if (isEdit) {
            let sel = document.createElement('select');
            sel.className = 'sysname-select';
            appData.sysNameList.forEach(opt => {
                let op = document.createElement('option');
                op.value = opt;
                op.textContent = opt;
                if (opt === proc.system.name) op.selected = true;
                sel.appendChild(op);
            });
            sel.onchange = () => { proc.system.name = sel.value; renderCurrentView(); };
            tdSysName.appendChild(sel);
        } else {
            tdSysName.innerText = proc.system.name;
        }

        let tdSysStat = row.insertCell();
        if (isEdit) {
            let sel = document.createElement('select');
            sel.className = 'sysstatus-select';
            appData.sysStatusList.forEach(opt => {
                let op = document.createElement('option');
                op.value = opt.value;
                op.textContent = opt.value;
                if (opt.value === proc.system.status) op.selected = true;
                sel.appendChild(op);
            });
            sel.onchange = () => { proc.system.status = sel.value; renderCurrentView(); };
            tdSysStat.appendChild(sel);
        } else {
            let color = appData.sysStatusList.find(s => s.value === proc.system.status)?.color || 'default';
            tdSysStat.innerHTML = `<span class="sys-status-badge ${color}">${escapeHtml(proc.system.status)}</span>`;
        }

        let tdAction = row.insertCell();
        if (isEdit) {
            let delBtn = document.createElement('button');
            delBtn.textContent = '✖';
            delBtn.className = 'delete-row-btn';
            delBtn.onclick = () => confirmDelete(proc, scenario);
            let subBtn = document.createElement('button');
            subBtn.textContent = '+ Sub';
            subBtn.className = 'add-sub-btn';
            subBtn.onclick = () => autoIncrementSubprocess(proc);
            tdAction.appendChild(delBtn);
            tdAction.appendChild(subBtn);
        }
    }

    if (activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit') {
        for (let proc of processes) {
            if (proc.seq.includes('.')) {
                let parent = getParentProcess(proc, scenario);
                if (parent && collapseState.get(parent.id) === true) {
                    let rows = tbody.querySelectorAll('tr');
                    for (let row of rows) {
                        if (row.cells[1] && row.cells[1].innerText === proc.seq) {
                            row.style.display = 'none';
                        }
                    }
                }
            }
        }
    }
}

// ============================
// 13. Render: Tree View
// ============================

function renderSequence() {
    let container = document.getElementById('sequenceFullView');
    let scenario = getCurrentScenario();
    if (!scenario) {
        if (container) container.innerHTML = '<div>No scenario</div>';
        return;
    }
    let processes = getProcessesForDisplay(scenario);
    if (processes.length === 0) {
        if (container) container.innerHTML = '<div>🔍 No matches</div>';
        return;
    }
    let { nodeMap, roots } = buildTree(processes);

    function renderTree(node, level) {
        let wrapper = document.createElement('div');
        wrapper.className = 'process-tree-root';
        let card = document.createElement('div');
        card.className = level === 0 ? 'main-card' : 'sub-card';
        let proc = node.process;
        let businessColor = appData.businessStatuses.find(s => s.value === proc.businessStatus)?.color || 'default';
        let sysColor = appData.sysStatusList.find(s => s.value === proc.system.status)?.color || 'default';
        let hasChildren = node.children.length > 0;
        let collapseBtn = '';
        if (level === 0 && hasChildren && activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit') {
            let isCollapsed = collapseState.get(proc.id) || false;
            collapseBtn = `<button class="collapse-icon" onclick="event.stopPropagation();toggleCollapse('${proc.id}')">${isCollapsed ? '▶' : '▼'}</button>`;
        }
        let addSubIcon = (currentMode === 'edit') ? `<div class="add-sub-icon" data-parent-id="${proc.id}" data-parent-seq="${proc.seq}">+</div>` : '';
        let docIcon = (proc.businessDoc && proc.businessDoc.trim()) ? '<span class="doc-icon">📄</span>' : '';
        let manualIcon = (proc.userManual && proc.userManual.trim()) ? '<span class="manual-icon">📘</span>' : '';

        card.innerHTML = `${addSubIcon}
            <div class="card-top-row"><span class="seq-badge">${level === 0 ? 'Step ' : ''}${escapeHtml(proc.seq)}</span><span class="status-badge ${businessColor}">🏢 ${escapeHtml(proc.businessStatus)}</span></div>
            <div class="card-content"><div class="seq-name">${collapseBtn}<span>${escapeHtml(proc.name)} ${docIcon}</span></div>
            <div class="seq-meta">👤 ${proc.raci.r.map(d => `<span class="raci-tag">${escapeHtml(d)}</span>`).join('')}</div>
            <div class="seq-meta">🖥️ ${escapeHtml(proc.system.name)} ${manualIcon} <span class="sys-status-badge ${sysColor}">${escapeHtml(proc.system.status)}</span></div></div>`;

        card.onclick = (e) => {
            if (!e.target.classList.contains('add-sub-icon') && !e.target.classList.contains('collapse-icon')) {
                openProcessDetail(proc.id);
            }
        };

        let collapseIcon = card.querySelector('.collapse-icon');
        if (collapseIcon) {
            collapseIcon.onclick = (e) => { e.stopPropagation(); toggleCollapse(proc.id); };
        }

        wrapper.appendChild(card);

        let isCollapsedParent = (level === 0 && collapseState.get(proc.id) === true);
        if (node.children.length > 0 && !(isCollapsedParent && activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit')) {
            let childrenDiv = document.createElement('div');
            childrenDiv.className = 'process-tree-children';
            for (let child of node.children) {
                let childNode = nodeMap.get(child.seq);
                if (childNode) childrenDiv.appendChild(renderTree(childNode, level + 1));
            }
            wrapper.appendChild(childrenDiv);
        }
        return wrapper;
    }

    if (container) {
        container.innerHTML = '';
        for (let root of roots) {
            container.appendChild(renderTree(root, 0));
        }
    }

    if (currentMode === 'edit') {
        document.querySelectorAll('.add-sub-icon').forEach(icon => {
            icon.onclick = (e) => {
                e.stopPropagation();
                let parentId = icon.getAttribute('data-parent-id');
                let parentProc = scenario.processes.find(p => p.id === parentId);
                if (!parentProc) return;
                document.getElementById('newSubSeq').value = '';
                document.getElementById('newSubName').value = '';
                document.getElementById('addSubModal').classList.add('active');
                pendingAddSubCallback = (seq, name) => {
                    if (seq && seq.trim()) {
                        addSubprocessWithInsertion(parentProc, seq.trim(), name.trim() || 'New Sub');
                    } else {
                        autoIncrementSubprocess(parentProc);
                    }
                    document.getElementById('addSubModal').classList.remove('active');
                    pendingAddSubCallback = null;
                };
            };
        });
    }
}

// ============================
// 14. Subprocess Operations
// ============================

function addSubprocessWithInsertion(parent, seq, name) {
    let sc = getCurrentScenario();
    if (!sc) return false;
    if (!seq.startsWith(parent.seq + '.')) {
        alert(`Must start with ${parent.seq}.`);
        return false;
    }
    let existing = sc.processes.find(p => p.seq === seq);
    if (existing) {
        let siblings = sc.processes.filter(p => p.seq.startsWith(parent.seq + '.') && p.seq !== parent.seq);
        let childNum = parseInt(seq.split('.')[1]);
        let toShift = siblings.filter(p => {
            let n = parseInt(p.seq.split('.')[1]);
            return n >= childNum;
        }).sort((a, b) => parseFloat(b.seq.split('.')[1]) - parseFloat(a.seq.split('.')[1]));
        for (let s of toShift) {
            let old = parseInt(s.seq.split('.')[1]);
            s.seq = parent.seq + '.' + (old + 1);
        }
    }
    let newProc = {
        id: genId(),
        seq: seq,
        name: name || 'New Sub',
        description: '',
        raci: { r: [...parent.raci.r], a: [], c: [], i: [] },
        businessStatus: 'Not Started',
        system: { name: parent.system.name, status: parent.system.status, responsible: parent.system.responsible },
        notes: '',
        businessDoc: '',
        userManual: ''
    };
    sc.processes.push(newProc);
    sc.processes = sortProcesses(sc.processes);
    renderCurrentView();
    return true;
}

function autoIncrementSubprocess(parent) {
    let sc = getCurrentScenario();
    let children = sc.processes.filter(p => p.seq.startsWith(parent.seq + '.'));
    let max = 0;
    children.forEach(c => {
        let parts = c.seq.split('.');
        if (parts.length === 2 && parts[0] === parent.seq) {
            max = Math.max(max, parseInt(parts[1]));
        }
    });
    let newSeq = parent.seq + '.' + (max + 1);
    let newProc = {
        id: genId(),
        seq: newSeq,
        name: parent.name + ' (sub)',
        description: '',
        raci: { r: [...parent.raci.r], a: [], c: [], i: [] },
        businessStatus: 'Not Started',
        system: { name: parent.system.name, status: parent.system.status, responsible: parent.system.responsible },
        notes: '',
        businessDoc: '',
        userManual: ''
    };
    sc.processes.push(newProc);
    sc.processes = sortProcesses(sc.processes);
    renderCurrentView();
}

function confirmDelete(proc, scenario) {
    let sub = scenario.processes.filter(p => p.seq.startsWith(proc.seq + '.') && p.id !== proc.id);
    document.getElementById('deleteModalMessage').innerText = `Delete "${proc.name}" (${proc.seq})?` + (sub.length ? `\nAlso ${sub.length} subprocess(es).` : '');
    document.getElementById('deleteConfirmModal').classList.add('active');
    pendingDeleteCallback = () => {
        scenario.processes = scenario.processes.filter(p => p.id !== proc.id && !sub.map(s => s.id).includes(p.id));
        scenario.processes = sortProcesses(scenario.processes);
        if (!proc.seq.includes('.')) collapseState.delete(proc.id);
        renderCurrentView();
        document.getElementById('deleteConfirmModal').classList.remove('active');
        pendingDeleteCallback = null;
    };
}

// ============================
// 15. RACI Rendering
// ============================

function renderRaciCheckboxes(proc) {
    let container = document.getElementById('raciCheckboxGrid');
    if (!container) return;
    let raciTypes = [
        { key: 'r', label: 'Responsible (R)' },
        { key: 'a', label: 'Accountable (A)' },
        { key: 'c', label: 'Consulted (C)' },
        { key: 'i', label: 'Informed (I)' }
    ];
    container.innerHTML = '';
    let isEdit = (currentMode === 'edit');

    for (let rt of raciTypes) {
        let section = document.createElement('div');
        section.className = 'raci-section';
        section.innerHTML = `<h4>${rt.label}</h4>`;
        let displayDiv = document.createElement('div');
        displayDiv.className = 'raci-display-section';
        displayDiv.id = `raci-display-${rt.key}`;
        let checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'checkbox-group';
        checkboxDiv.id = `raci-checkbox-${rt.key}`;
        section.appendChild(displayDiv);
        section.appendChild(checkboxDiv);
        container.appendChild(section);

        for (let dept of appData.departments) {
            let chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = dept;
            chk.checked = proc.raci[rt.key].includes(dept);
            let label = document.createElement('label');
            label.textContent = dept;
            let item = document.createElement('div');
            item.className = 'checkbox-item';
            item.appendChild(chk);
            item.appendChild(label);
            checkboxDiv.appendChild(item);
            if (isEdit) {
                chk.onchange = () => {
                    if (chk.checked) {
                        if (!proc.raci[rt.key].includes(dept)) proc.raci[rt.key].push(dept);
                    } else {
                        proc.raci[rt.key] = proc.raci[rt.key].filter(d => d !== dept);
                    }
                    updateRaciDisplay(proc);
                };
            }
        }
        if (isEdit) {
            displayDiv.style.display = 'none';
            checkboxDiv.style.display = 'block';
        } else {
            displayDiv.style.display = 'block';
            checkboxDiv.style.display = 'none';
        }
    }
    updateRaciDisplay(proc);
}

function updateRaciDisplay(proc) {
    for (let key of ['r', 'a', 'c', 'i']) {
        let div = document.getElementById(`raci-display-${key}`);
        if (div) {
            div.innerHTML = proc.raci[key].length ?
                proc.raci[key].map(d => `<span class="raci-tag">${escapeHtml(d)}</span>`).join('') :
                '<div style="color:#94a3b8;">No selections</div>';
        }
    }
}

function updateDocumentLinkIcon(inputId, linkIconId) {
    let input = document.getElementById(inputId);
    let icon = document.getElementById(linkIconId);
    if (!input || !icon) return;
    let url = input.value.trim();
    if (url) {
        icon.style.display = 'inline-block';
        icon.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank'); };
    } else {
        icon.style.display = 'none';
        icon.onclick = null;
    }
}

// ============================
// 16. Process Detail Modal
// ============================

function openProcessDetail(procId) {
    let scenario = getCurrentScenario();
    let proc = scenario.processes.find(p => p.id === procId);
    if (!proc) return;
    currentEditingProcess = { scenarioId: scenario.id, processId: proc.id };

    document.getElementById('modalSeq').value = proc.seq;
    document.getElementById('modalName').value = proc.name;
    document.getElementById('modalDescription').value = proc.description || '';
    renderRaciCheckboxes(proc);

    let statusSel = document.getElementById('modalStatus');
    statusSel.innerHTML = '';
    appData.businessStatuses.forEach(s => {
        let op = document.createElement('option');
        op.value = s.value;
        op.textContent = s.value;
        if (s.value === proc.businessStatus) op.selected = true;
        statusSel.appendChild(op);
    });

    let sysNameSel = document.getElementById('modalSysName');
    sysNameSel.innerHTML = '';
    appData.sysNameList.forEach(opt => {
        let op = document.createElement('option');
        op.value = opt;
        op.textContent = opt;
        if (opt === proc.system.name) op.selected = true;
        sysNameSel.appendChild(op);
    });

    let sysStatSel = document.getElementById('modalSysStatus');
    sysStatSel.innerHTML = '';
    appData.sysStatusList.forEach(opt => {
        let op = document.createElement('option');
        op.value = opt.value;
        op.textContent = opt.value;
        if (opt.value === proc.system.status) op.selected = true;
        sysStatSel.appendChild(op);
    });

    let sysRespSel = document.getElementById('modalSysResp');
    sysRespSel.innerHTML = '';
    appData.sysRespList.forEach(opt => {
        let op = document.createElement('option');
        op.value = opt;
        op.textContent = opt;
        if (opt === proc.system.responsible) op.selected = true;
        sysRespSel.appendChild(op);
    });

    document.getElementById('modalBusinessDoc').value = proc.businessDoc || '';
    document.getElementById('modalUserManual').value = proc.userManual || '';
    document.getElementById('modalNotes').value = proc.notes || '';

    updateDocumentLinkIcon('modalBusinessDoc', 'businessDocLink');
    updateDocumentLinkIcon('modalUserManual', 'userManualLink');

    let isEdit = (currentMode === 'edit');
    ['modalSeq', 'modalName', 'modalDescription', 'modalStatus', 'modalSysName', 'modalSysStatus', 'modalSysResp', 'modalBusinessDoc', 'modalUserManual', 'modalNotes'].forEach(id => {
        let el = document.getElementById(id);
        if (el) el.disabled = !isEdit;
    });

    document.getElementById('processDetailModal').classList.add('active');
}

function closeModal() {
    document.getElementById('processDetailModal').classList.remove('active');
    currentEditingProcess = null;
}

function saveModal() {
    if (currentMode !== 'edit' || !currentEditingProcess) return;
    let scenario = getScenarioById(currentEditingProcess.scenarioId);
    let proc = scenario.processes.find(p => p.id === currentEditingProcess.processId);
    if (!proc) return;

    let newSeq = document.getElementById('modalSeq').value.trim();
    if (newSeq !== proc.seq && !isSeqUnique(scenario, newSeq, proc.id)) {
        alert('Sequence exists');
        return;
    }
    proc.seq = newSeq || '0';
    proc.name = document.getElementById('modalName').value;
    proc.description = document.getElementById('modalDescription').value;
    proc.businessStatus = document.getElementById('modalStatus').value;
    proc.system = {
        name: document.getElementById('modalSysName').value,
        status: document.getElementById('modalSysStatus').value,
        responsible: document.getElementById('modalSysResp').value
    };
    proc.businessDoc = document.getElementById('modalBusinessDoc').value;
    proc.userManual = document.getElementById('modalUserManual').value;
    proc.notes = document.getElementById('modalNotes').value;

    scenario.processes = sortProcesses(scenario.processes);
    renderCurrentView();
    closeModal();
}

// ============================
// 17. Master Data UI
// ============================

function refreshMasterUI() {
    let isEdit = (currentMode === 'edit');
    let html = `
        <div class="master-section"><h3>🏢 Departments / Roles</h3><div>${appData.departments.map((d, i) => `<div class="list-tag">${escapeHtml(d)} ${isEdit ? `<button data-type="dept" data-idx="${i}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newDept" placeholder="New department"><button id="addDeptBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>🖥️ System Name</h3><div>${appData.sysNameList.map((v, i) => `<div class="list-tag">${escapeHtml(v)} ${isEdit ? `<button data-type="sysname" data-idx="${i}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newSysName" placeholder="New system"><button id="addSysNameBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>📊 System Status</h3><div>${appData.sysStatusList.map((item, idx) => `<div class="list-tag">${escapeHtml(item.value)} ${isEdit ? `<select class="sysstatus-color" data-idx="${idx}"><option value="default">default</option><option value="red">red</option><option value="yellow">yellow</option><option value="green" ${item.color === 'green' ? 'selected' : ''}>green</option></select> <button data-type="sysstatus" data-idx="${idx}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newSysStatus" placeholder="New status"><button id="addSysStatusBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>👤 System Responsible</h3><div>${appData.sysRespList.map((v, i) => `<div class="list-tag">${escapeHtml(v)} ${isEdit ? `<button data-type="sysresp" data-idx="${i}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newSysResp" placeholder="New responsible"><button id="addSysRespBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>📌 Business Status</h3><div>${appData.businessStatuses.map((item, idx) => `<div class="list-tag">${escapeHtml(item.value)} ${isEdit ? `<select class="busstatus-color" data-idx="${idx}"><option value="default">default</option><option value="red">red</option><option value="yellow">yellow</option><option value="green" ${item.color === 'green' ? 'selected' : ''}>green</option></select> <button data-type="busstatus" data-idx="${idx}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newBusinessStatus" placeholder="New status"><button id="addBusinessStatusBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>`;

    if (isEdit) {
        html += `<div class="modal-buttons" style="justify-content: space-between; margin-top:1rem;"><div><button id="exportMasterBtn" class="icon-btn">📤 Export CSV</button><button id="importMasterBtn" class="icon-btn">📥 Import CSV</button></div></div>`;
    }

    document.getElementById('masterContent').innerHTML = html;
    if (!isEdit) return;

    document.querySelectorAll('.master-del').forEach(btn => {
        btn.onclick = () => {
            let type = btn.getAttribute('data-type');
            let idx = parseInt(btn.getAttribute('data-idx'));
            if (type === 'dept') appData.departments.splice(idx, 1);
            else if (type === 'sysname') appData.sysNameList.splice(idx, 1);
            else if (type === 'sysstatus') appData.sysStatusList.splice(idx, 1);
            else if (type === 'sysresp') appData.sysRespList.splice(idx, 1);
            else if (type === 'busstatus') appData.businessStatuses.splice(idx, 1);
            refreshMasterUI();
            renderCurrentView();
        };
    });

    document.querySelectorAll('.sysstatus-color').forEach(sel => {
        sel.onchange = () => {
            let idx = parseInt(sel.getAttribute('data-idx'));
            if (appData.sysStatusList[idx]) {
                appData.sysStatusList[idx].color = sel.value;
                refreshMasterUI();
                renderCurrentView();
            }
        };
    });
    document.querySelectorAll('.busstatus-color').forEach(sel => {
        sel.onchange = () => {
            let idx = parseInt(sel.getAttribute('data-idx'));
            if (appData.businessStatuses[idx]) {
                appData.businessStatuses[idx].color = sel.value;
                refreshMasterUI();
                renderCurrentView();
            }
        };
    });

    document.getElementById('addDeptBtn').onclick = () => {
        let v = document.getElementById('newDept').value.trim();
        if (v) { appData.departments.push(v); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addSysNameBtn').onclick = () => {
        let v = document.getElementById('newSysName').value.trim();
        if (v) { appData.sysNameList.push(v); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addSysStatusBtn').onclick = () => {
        let v = document.getElementById('newSysStatus').value.trim();
        if (v) { appData.sysStatusList.push({ value: v, color: 'default' }); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addSysRespBtn').onclick = () => {
        let v = document.getElementById('newSysResp').value.trim();
        if (v) { appData.sysRespList.push(v); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addBusinessStatusBtn').onclick = () => {
        let v = document.getElementById('newBusinessStatus').value.trim();
        if (v) { appData.businessStatuses.push({ value: v, color: 'default' }); refreshMasterUI(); renderCurrentView(); }
    };

    document.getElementById('exportMasterBtn').onclick = exportMasterCSV;
    document.getElementById('importMasterBtn').onclick = () => document.getElementById('masterImportFile').click();
}

// ============================
// 18. CSV Import/Export
// ============================

const CSV_SEP = '|';

function csvEscape(s) {
    if (s === null || s === undefined) return '';
    s = String(s);
    if (s.includes(CSV_SEP) || s.includes('"') || s.includes('\n') || s.includes('=')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

async function saveFilePicker(content, name) {
    if (window.showSaveFilePicker) {
        try {
            const h = await window.showSaveFilePicker({
                suggestedName: name,
                types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
            });
            const w = await h.createWritable();
            await w.write(content);
            await w.close();
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    let a = document.createElement('a');
    let url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportMasterCSV() {
    let lines = [];
    appData.departments.forEach(d => lines.push(['dept', d].map(csvEscape).join(CSV_SEP)));
    appData.sysNameList.forEach(v => lines.push(['sysname', v].map(csvEscape).join(CSV_SEP)));
    appData.sysStatusList.forEach(s => lines.push(['sysstatus', s.value, s.color].map(csvEscape).join(CSV_SEP)));
    appData.sysRespList.forEach(v => lines.push(['sysresp', v].map(csvEscape).join(CSV_SEP)));
    appData.businessStatuses.forEach(b => lines.push(['busstatus', b.value, b.color].map(csvEscape).join(CSV_SEP)));
    saveFilePicker(lines.join('\n'), `master_${new Date().toISOString().slice(0, 10)}.csv`);
}

function handleMasterImport(e) {
    let file = e.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = ev => {
        let lines = ev.target.result.split(/\r?\n/);
        let newDepts = [], newSysNames = [], newSysStatuses = [], newSysResps = [], newBusStatuses = [];
        for (let line of lines) {
            let parts = line.split(CSV_SEP);
            if (parts[0] === 'dept' && parts[1]) newDepts.push(parts[1]);
            else if (parts[0] === 'sysname' && parts[1]) newSysNames.push(parts[1]);
            else if (parts[0] === 'sysstatus' && parts[1] && parts[2]) newSysStatuses.push({ value: parts[1], color: parts[2] });
            else if (parts[0] === 'sysresp' && parts[1]) newSysResps.push(parts[1]);
            else if (parts[0] === 'busstatus' && parts[1] && parts[2]) newBusStatuses.push({ value: parts[1], color: parts[2] });
        }
        if (newDepts.length) appData.departments = newDepts;
        if (newSysNames.length) appData.sysNameList = newSysNames;
        if (newSysStatuses.length) appData.sysStatusList = newSysStatuses;
        if (newSysResps.length) appData.sysRespList = newSysResps;
        if (newBusStatuses.length) appData.businessStatuses = newBusStatuses;
        refreshMasterUI();
        renderCurrentView();
    };
    reader.readAsText(file);
    e.target.value = '';
}

async function exportProcesses() {
    let sc = getCurrentScenario();
    if (!sc) { alert('No scenario selected'); return; }
    let headers = ['Seq', 'Name', 'Description', 'R_Responsible', 'A_Accountable', 'C_Consulted', 'I_Informed', 'BusinessStatus', 'SystemName', 'SystemStatus', 'SystemResponsible', 'BusinessDoc', 'UserManual', 'Notes'];
    let lines = [headers.map(csvEscape).join(CSV_SEP)];
    for (let p of sortProcesses(sc.processes)) {
        const makeHyperlink = (url) => url && url.trim() ? `=HYPERLINK("${url.replace(/"/g, '""')}","${url}")` : '';
        let row = [
            p.seq, p.name, p.description || '',
            p.raci.r.join(';'), p.raci.a.join(';'), p.raci.c.join(';'), p.raci.i.join(';'),
            p.businessStatus, p.system.name || '', p.system.status || '', p.system.responsible || '',
            makeHyperlink(p.businessDoc), makeHyperlink(p.userManual), p.notes || ''
        ];
        lines.push(row.map(csvEscape).join(CSV_SEP));
    }
    saveFilePicker(lines.join('\n'), `${sc.name.replace(/\s+/g, '_')}_processes_${new Date().toISOString().slice(0, 10)}.csv`);
}

function importProcesses() {
    if (currentMode !== 'edit') return;
    document.getElementById('processImportFile').click();
}

function handleProcessImport(e) {
    let file = e.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = ev => {
        let lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return;
        let headers = lines[0].split(CSV_SEP).map(h => h.replace(/^"|"$/g, '').trim());
        let processes = [];
        for (let i = 1; i < lines.length; i++) {
            let parts = lines[i].split(CSV_SEP);
            let obj = {};
            headers.forEach((h, idx) => {
                obj[h] = parts[idx] ? parts[idx].replace(/^"|"$/g, '').trim() : '';
            });
            if (!obj.Seq) continue;
            processes.push({
                id: genId(),
                seq: obj.Seq,
                name: obj.Name || 'Unnamed',
                description: obj.Description || '',
                raci: {
                    r: obj.R_Responsible ? obj.R_Responsible.split(';') : [],
                    a: obj.A_Accountable ? obj.A_Accountable.split(';') : [],
                    c: obj.C_Consulted ? obj.C_Consulted.split(';') : [],
                    i: obj.I_Informed ? obj.I_Informed.split(';') : []
                },
                businessStatus: obj.BusinessStatus || appData.businessStatuses[0]?.value || 'Not Defined',
                system: { name: obj.SystemName || '', status: obj.SystemStatus || '', responsible: obj.SystemResponsible || '' },
                businessDoc: obj.BusinessDoc || '',
                userManual: obj.UserManual || '',
                notes: obj.Notes || ''
            });
        }
        showImportPreview('Processes', `Found ${processes.length} valid processes.`, headers, processes.map(p => [
            p.seq, p.name, p.description,
            p.raci.r.join(';'), p.raci.a.join(';'), p.raci.c.join(';'), p.raci.i.join(';'),
            p.businessStatus, p.system.name, p.system.status, p.system.responsible,
            p.businessDoc, p.userManual, p.notes
        ]), () => {
            let sc = getCurrentScenario();
            if (sc) {
                sc.processes = processes;
                sc.processes = sortProcesses(sc.processes);
                renderCurrentView();
            }
            closeImportPreview();
        });
    };
    reader.readAsText(file);
    e.target.value = '';
}

function showImportPreview(title, summary, headers, rows, cb) {
    let modal = document.getElementById('importPreviewModal');
    document.getElementById('previewSummary').innerText = summary;
    let container = document.getElementById('previewTableContainer');
    container.innerHTML = '';
    if (rows.length) {
        let table = document.createElement('table');
        table.className = 'preview-table';
        let thead = document.createElement('thead');
        let headerRow = document.createElement('tr');
        headers.forEach(h => {
            let th = document.createElement('th');
            th.textContent = h;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        let tbody = document.createElement('tbody');
        rows.forEach(row => {
            let tr = document.createElement('tr');
            row.forEach(cell => {
                let td = document.createElement('td');
                td.textContent = cell || '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        container.appendChild(table);
    } else {
        container.innerHTML = '<p>No data</p>';
    }
    pendingImportCallback = cb;
    modal.classList.add('active');
}

function closeImportPreview() {
    document.getElementById('importPreviewModal').classList.remove('active');
    pendingImportCallback = null;
}

// ============================
// 19. Filter Functions
// ============================

function openFilterColumnsModal() {
    let container = document.getElementById('filterColumnsList');
    container.innerHTML = '';
    for (let [key, label] of Object.entries(columnNames)) {
        container.innerHTML += `<div class="checkbox-item"><input type="checkbox" value="${key}" id="col_${key}"> <label for="col_${key}">${label}</label></div>`;
    }
    document.getElementById('filterColumnsModal').classList.add('active');
}

function addFiltersFromSelection() {
    let selected = Array.from(document.querySelectorAll('#filterColumnsList input:checked')).map(cb => cb.value);
    if (selected.length === 0) return;
    for (let col of selected) {
        if (!activeFilters.some(f => f.column === col)) {
            activeFilters.push({ column: col, values: [] });
        }
    }
    rebuildFilterUI();
    applyFiltersAndRender();
    document.getElementById('filterColumnsModal').classList.remove('active');
}

function rebuildFilterUI() {
    let container = document.getElementById('filterConditions');
    container.innerHTML = '';
    activeFilters.forEach((f, idx) => {
        let div = document.createElement('div');
        div.className = 'filter-row';
        let span = document.createElement('span');
        span.textContent = columnNames[f.column] || f.column;
        let input = document.createElement('input');
        input.placeholder = 'Values (comma separated)';
        input.value = f.values.join(',');
        input.onchange = () => {
            f.values = input.value.split(',').map(v => v.trim()).filter(v => v);
            applyFiltersAndRender();
        };
        let delBtn = document.createElement('button');
        delBtn.textContent = '✖';
        delBtn.onclick = () => {
            activeFilters.splice(idx, 1);
            rebuildFilterUI();
            applyFiltersAndRender();
        };
        div.appendChild(span);
        div.appendChild(input);
        div.appendChild(delBtn);
        container.appendChild(div);
    });
}

function applyFiltersAndRender() {
    renderCurrentView();
}

function clearFilters() {
    activeFilters = [];
    rebuildFilterUI();
    document.getElementById('searchInput').value = '';
    searchKeyword = '';
    renderCurrentView();
}

// ============================
// 20. Scenario Management
// ============================

function refreshScenarioDropdown() {
    let sel = document.getElementById('scenarioSelect');
    if (!sel) return;
    sel.innerHTML = '';
    appData.scenarios.forEach(sc => {
        let opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        if (sc.id === appData.currentScenarioId) opt.selected = true;
        sel.appendChild(opt);
    });
}

// ============================
// 21. Main Render Function
// ============================

function renderApp() {
    console.log('🎨 renderApp() called');
    const root = document.getElementById('app-root');
    if (!root) {
        console.error('❌ app-root not found');
        return;
    }

    if (!root.innerHTML) {
        root.innerHTML = `
            <div class="glass-dashboard edit-mode" id="appRoot">
                <div class="top-header">
                    <div class="title-section"><h1>📊 Business Process Orchestrator</h1><p>EBRO Factory Repository for all business processes details</p></div>
                    <div>
                        <button id="saveDataBtn" class="save-html-btn" style="display:inline-flex;">💾 Save to GitHub</button>
                        <button id="settingsBtn" class="settings-btn" style="display:inline-flex;">⚙️ Master Data</button>
                        <button id="modeToggleBtn" class="mode-toggle-btn">👁️ Display Mode</button>
                    </div>
                </div>
                <div class="scenario-panel">
                    <span class="scenario-label">📁 Business Scenario:</span>
                    <select id="scenarioSelect"></select>
                    <div class="scenario-actions">
                        <button id="newScenarioBtn" class="icon-btn">+ New</button>
                        <button id="renameScenarioBtn" class="icon-btn">✎ Rename</button>
                        <button id="deleteScenarioBtn" class="icon-btn danger-btn">🗑 Delete</button>
                    </div>
                </div>
                <div class="action-bar">
                    <div class="search-wrapper"><span>🔍</span><input type="text" id="searchInput" placeholder="Search..."></div>
                    <div style="display:flex;gap:0.5rem;">
                        <button id="collapseAllBtn" class="collapse-all-btn">📁 Collapse All</button>
                        <button id="expandAllBtn" class="expand-all-btn">📂 Expand All</button>
                        <button class="btn-add" id="addRowBtn" style="display:inline-flex;">➕ Add Process</button>
                        <button class="icon-btn" id="exportProcessesBtn">📤 Export Processes</button>
                        <button class="icon-btn" id="importProcessesBtn" style="display:inline-flex;">📥 Import Processes</button>
                    </div>
                </div>
                <div class="view-tabs">
                    <button id="tableViewTab" class="tab-btn active">📋 Process Table</button>
                    <button id="sequenceViewTab" class="tab-btn">🌳 Process Tree</button>
                </div>
                <div class="filter-panel">
                    <div class="filter-conditions" id="filterConditions"></div>
                    <div class="filter-actions">
                        <button id="addFilterBtn" class="icon-btn">+ Add Filter</button>
                        <button id="clearFiltersBtn" class="icon-btn">Clear Filters</button>
                    </div>
                </div>
                <div id="tableViewPanel" style="display:none;">
                    <div class="table-container">
                        <table class="flow-table">
                            <thead><tr>
                                <th style="width:40px"></th><th>Seq</th><th>Process Name</th><th>Responsible (R)</th>
                                <th>Business Status</th><th>System Name</th><th>System Status</th>
                                <th id="actionsHeader" style="display:table-cell;">Actions</th>
                            </tr></thead>
                            <tbody id="tableBody"></tbody>
                        </table>
                    </div>
                    <div id="noResultMsg" class="no-result" style="display:none;">📭 No matching processes</div>
                </div>
                <div id="sequenceViewPanel" style="display:block;">
                    <div class="sequence-fullview" id="sequenceFullView">Loading sequence...</div>
                </div>
            </div>
            <div id="deleteConfirmModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>⚠️ Confirm Deletion</h3><p id="deleteModalMessage"></p>
                <div class="modal-buttons"><button id="deleteAcceptBtn" class="save-btn">Accept</button><button id="deleteCancelBtn" class="cancel-btn">Cancel</button></div></div>
            </div>
            <div id="addSubModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>➕ Add Subprocess</h3>
                <div class="field-group"><label>Sequence (empty = auto)</label><input type="text" id="newSubSeq"></div>
                <div class="field-group"><label>Process Name</label><input type="text" id="newSubName"></div>
                <div class="modal-buttons"><button id="addSubAcceptBtn" class="save-btn">Add</button><button id="addSubCancelBtn" class="cancel-btn">Cancel</button></div></div>
            </div>
            <div id="masterModal" class="master-modal">
                <div class="master-container"><h2>📋 Master Data</h2><div id="masterContent"></div>
                <div class="modal-buttons"><button id="closeMasterBtn" class="cancel-btn">Close</button></div></div>
            </div>
            <div id="processDetailModal" class="modal-overlay">
                <div class="modal-container"><h2>📄 Process Details</h2>
                <div class="form-row" style="display:flex;gap:1rem;">
                    <div class="field-group"><label>Sequence</label><input type="text" id="modalSeq"></div>
                    <div class="field-group"><label>Process Name</label><input type="text" id="modalName"></div>
                </div>
                <div class="field-group"><label>📝 Description</label><textarea id="modalDescription" rows="3"></textarea></div>
                <div class="raci-grid" id="raciCheckboxGrid"></div>
                <div class="form-row" style="display:flex;gap:1rem;">
                    <div class="field-group"><label>Business Status</label><select id="modalStatus"></select></div>
                    <div class="field-group"><label>📄 Business Doc</label><div class="field-group-with-icon"><input type="text" id="modalBusinessDoc"><span id="businessDocLink" class="link-icon" style="display:inline-block;">🔗</span></div></div>
                </div>
                <div class="form-row" style="display:flex;gap:1rem;">
                    <div class="field-group"><label>System Name</label><select id="modalSysName"></select></div>
                    <div class="field-group"><label>System Status</label><select id="modalSysStatus"></select></div>
                    <div class="field-group"><label>System Responsible</label><select id="modalSysResp"></select></div>
                    <div class="field-group"><label>📘 User Manual</label><div class="field-group-with-icon"><input type="text" id="modalUserManual"><span id="userManualLink" class="link-icon" style="display:none;">🔗</span></div></div>
                </div>
                <div class="field-group"><label>📝 Notes</label><textarea id="modalNotes" rows="2"></textarea></div>
                <div class="modal-buttons"><button id="cancelModalBtn" class="cancel-btn">Cancel</button><button id="saveModalBtn" class="save-btn">Save</button></div></div>
            </div>
            <div id="filterColumnsModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>Select filter columns</h3>
                <div id="filterColumnsList" style="max-height:300px;overflow-y:auto;margin:1rem 0;"></div>
                <div class="modal-buttons"><button id="filterColumnsConfirm" class="save-btn">Add Filters</button><button id="filterColumnsCancel" class="cancel-btn">Cancel</button></div></div>
            </div>
            <div id="importPreviewModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>📋 Import Preview</h3>
                <div id="previewSummary"></div>
                <div id="previewTableContainer"></div>
                <div class="modal-buttons"><button id="importConfirmBtn" class="save-btn">Confirm</button><button id="importCancelBtn" class="cancel-btn">Cancel</button></div></div>
            </div>
            <input type="file" id="masterImportFile" accept=".csv" style="display:none">
            <input type="file" id="processImportFile" accept=".csv" style="display:none">
        `;
    }

    updateUIVisibility();
    refreshScenarioDropdown();
    rebuildFilterUI();
    bindEvents();
    renderCurrentView();
    console.log('✅ renderApp() completed');
}

// ============================
// 22. Event Binding
// ============================

function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    document.getElementById('scenarioSelect').onchange = (e) => {
        appData.currentScenarioId = e.target.value;
        collapseState.clear();
        renderCurrentView();
    };

    document.getElementById('newScenarioBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        let name = prompt('Scenario name:', 'New');
        if (name) {
            let id = genId();
            appData.scenarios.push({ id, name, processes: [] });
            appData.currentScenarioId = id;
            refreshScenarioDropdown();
            renderCurrentView();
        }
    };

    document.getElementById('renameScenarioBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        let sc = getCurrentScenario();
        if (sc) {
            let nn = prompt('Rename:', sc.name);
            if (nn) sc.name = nn;
            refreshScenarioDropdown();
            renderCurrentView();
        }
    };

    document.getElementById('deleteScenarioBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        if (appData.scenarios.length <= 1) { alert('Cannot delete last scenario'); return; }
        if (confirm('Delete scenario?')) {
            appData.scenarios = appData.scenarios.filter(s => s.id !== appData.currentScenarioId);
            appData.currentScenarioId = appData.scenarios[0].id;
            collapseState.clear();
            refreshScenarioDropdown();
            renderCurrentView();
        }
    };

    document.getElementById('addRowBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        let sc = getCurrentScenario();
        if (!sc) return;
        let max = 0;
        sc.processes.forEach(p => {
            if (!p.seq.includes('.')) max = Math.max(max, parseFloat(p.seq));
        });
        let newSeq = (max + 10).toString();
        sc.processes.push({
            id: genId(),
            seq: newSeq,
            name: 'New Step',
            description: '',
            raci: { r: [], a: [], c: [], i: [] },
            businessStatus: appData.businessStatuses[0]?.value || 'Not Defined',
            system: { name: appData.sysNameList[0] || '', status: appData.sysStatusList[0]?.value || 'Operational', responsible: '' },
            notes: '',
            businessDoc: '',
            userManual: ''
        });
        sc.processes = sortProcesses(sc.processes);
        renderCurrentView();
    };

    document.getElementById('modeToggleBtn').onclick = function() {
        if (currentMode === 'display') {
            const pwd = prompt('Enter edit password:');
            if (pwd !== 'admin') {
                alert('Incorrect password');
                return;
            }
            currentMode = 'edit';
            collapseState.clear();
            const token = getGitHubToken();
            if (!token) {
                const newToken = prompt(
                    '🔑 Enter your GitHub Token to enable saving\n\n' +
                    'The Token will be saved in your browser.',
                    ''
                );
                if (newToken && newToken.trim()) {
                    setGitHubToken(newToken);
                    alert('✅ Token saved to browser local storage');
                } else {
                    alert('⚠️ No Token provided. You can still edit data, but saving to GitHub will not work.');
                }
            }
            renderCurrentView();
            updateUIVisibility();
        } else {
            currentMode = 'display';
            const sc = getCurrentScenario();
            if (sc) {
                for (let p of sc.processes) {
                    if (!p.seq.includes('.')) collapseState.set(p.id, true);
                }
            }
            renderCurrentView();
            updateUIVisibility();
        }
    };

    document.getElementById('saveDataBtn').onclick = () => {
        saveDataToGitHub(appData);
    };

    document.getElementById('settingsBtn').onclick = () => {
        refreshMasterUI();
        document.getElementById('masterModal').classList.add('active');
    };
    document.getElementById('closeMasterBtn').onclick = () => document.getElementById('masterModal').classList.remove('active');

    document.getElementById('tableViewTab').onclick = () => setView('table');
    document.getElementById('sequenceViewTab').onclick = () => setView('sequence');

    document.getElementById('searchInput').oninput = (e) => {
        searchKeyword = e.target.value;
        renderCurrentView();
    };

    document.getElementById('collapseAllBtn').onclick = collapseAllParents;
    document.getElementById('expandAllBtn').onclick = expandAllParents;

    document.getElementById('addFilterBtn').onclick = openFilterColumnsModal;
    document.getElementById('clearFiltersBtn').onclick = clearFilters;
    document.getElementById('filterColumnsConfirm').onclick = addFiltersFromSelection;
    document.getElementById('filterColumnsCancel').onclick = () => document.getElementById('filterColumnsModal').classList.remove('active');

    document.getElementById('exportProcessesBtn').onclick = exportProcesses;
    document.getElementById('importProcessesBtn').onclick = importProcesses;

    document.getElementById('cancelModalBtn').onclick = closeModal;
    document.getElementById('saveModalBtn').onclick = saveModal;

    document.getElementById('deleteAcceptBtn').onclick = () => {
        if (pendingDeleteCallback) pendingDeleteCallback();
        document.getElementById('deleteConfirmModal').classList.remove('active');
    };
    document.getElementById('deleteCancelBtn').onclick = () => document.getElementById('deleteConfirmModal').classList.remove('active');

    document.getElementById('addSubAcceptBtn').onclick = () => {
        if (pendingAddSubCallback) {
            pendingAddSubCallback(document.getElementById('newSubSeq').value, document.getElementById('newSubName').value);
        } else {
            document.getElementById('addSubModal').classList.remove('active');
        }
    };
    document.getElementById('addSubCancelBtn').onclick = () => {
        document.getElementById('addSubModal').classList.remove('active');
        pendingAddSubCallback = null;
    };

    document.getElementById('importConfirmBtn').onclick = () => {
        if (pendingImportCallback) pendingImportCallback();
        closeImportPreview();
    };
    document.getElementById('importCancelBtn').onclick = closeImportPreview;

    document.getElementById('masterImportFile').onchange = handleMasterImport;
    document.getElementById('processImportFile').onchange = handleProcessImport;

    document.getElementById('modalBusinessDoc').addEventListener('input', () => updateDocumentLinkIcon('modalBusinessDoc', 'businessDocLink'));
    document.getElementById('modalUserManual').addEventListener('input', () => updateDocumentLinkIcon('modalUserManual', 'userManualLink'));
}

// ============================
// 23. View Control
// ============================

function setView(view) {
    currentView = view;
    document.getElementById('tableViewPanel').style.display = view === 'table' ? 'block' : 'none';
    document.getElementById('sequenceViewPanel').style.display = view === 'sequence' ? 'block' : 'none';
    document.getElementById('tableViewTab').classList.toggle('active', view === 'table');
    document.getElementById('sequenceViewTab').classList.toggle('active', view === 'sequence');
    renderCurrentView();
}

function renderCurrentView() {
    if (currentView === 'table') {
        renderTable();
    } else {
        renderSequence();
    }
    updateUIVisibility();
}

function updateUIVisibility() {
    const isEdit = currentMode === 'edit';
    const root = document.getElementById('appRoot');
    if (!root) return;

    root.classList.toggle('display-mode', !isEdit);
    root.classList.toggle('edit-mode', isEdit);

    const addBtn = document.getElementById('addRowBtn');
    const importBtn = document.getElementById('importProcessesBtn');
    const saveBtn = document.getElementById('saveDataBtn');
    const modeBtn = document.getElementById('modeToggleBtn');

    if (addBtn) addBtn.style.display = isEdit ? 'inline-flex' : 'none';
    if (importBtn) importBtn.style.display = isEdit ? 'inline-flex' : 'none';
    if (saveBtn) saveBtn.style.display = isEdit ? 'inline-flex' : 'none';
    if (modeBtn) modeBtn.innerHTML = isEdit ? '👁️ Display Mode' : '✏️ Edit Mode';

    const token = getGitHubToken();
    let statusDiv = document.getElementById('tokenStatus');
    
    if (isEdit) {
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'tokenStatus';
            statusDiv.style.marginLeft = '1rem';
            statusDiv.style.fontSize = '0.85rem';
            const titleSection = document.querySelector('.title-section');
            if (titleSection) titleSection.appendChild(statusDiv);
        }
        statusDiv.style.display = 'block';
        if (token) {
            statusDiv.innerHTML = '🟢 Token configured';
            statusDiv.style.color = '#16a34a';
        } else {
            statusDiv.innerHTML = '🔴 No Token - Cannot save to GitHub';
            statusDiv.style.color = '#dc2626';
        }
    } else if (statusDiv) {
        statusDiv.style.display = 'none';
    }
}

// ============================
// 24. Page Startup
// ============================

console.log('🚀 Starting app...');

document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOMContentLoaded event');
    const token = getGitHubToken();
    if (!token) {
        if (confirm('🔑 GitHub Token Required\n\nClick "OK" to enter your token, or "Cancel" to proceed in read-only mode.')) {
            showTokenSetup();
        }
    }
    loadData();
});

// ============================
// 25. Expose Global Functions
// ============================

window.toggleCollapse = toggleCollapse;
window.openProcessDetail = openProcessDetail;
window.saveDataToGitHub = saveDataToGitHub;
window.setupToken = showTokenSetup;
window.loadData = loadData;
window.renderApp = renderApp;

console.log('✅ app.js initialization complete');
