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

        // ✅ FIX: Force snapshot sync if scenarios were deleted
        if (lastSnapshot && data.scenarios.length < lastSnapshot.scenarios.length) {
            console.log('📸 Scenario count decreased, forcing snapshot update');
            saveSnapshot(data);
            // Re-read the snapshot we just saved
            lastSnapshot = JSON.parse(JSON.stringify(data));
        }

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
            collapseBtn = `<button class="collapse-icon" onclick="event.stopPropagation();toggleCollapse('${proc.id}')">${isCollapsed ? '▶' : '▼'}</
