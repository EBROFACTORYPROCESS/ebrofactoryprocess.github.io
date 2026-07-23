// ============================================================
// app.js - Complete Core Logic
// ============================================================

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

// ============================
// 2. Utility Functions
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

function isSeqUnique(scenario, seq, excludeId) {
    return !scenario.processes.some(p => p.seq === seq && p.id !== excludeId);
}

// ============================
// 3. Data Normalization
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
            if (!p.id) p.id = genId();
        }
        sc.processes = sortProcesses(sc.processes);
    }
    return data;
}

// ============================
// 4. Token Management
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

// ============================
// 5. Snapshot Management (for diff)
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
        saveSnapshot(data);
        console.log('📸 Initial snapshot created');
    }
}

function generateDiff(oldData, newData) {
    // Fallback: simple diff if jsondiffpatch is not available
    if (typeof jsondiffpatch === 'undefined' || !jsondiffpatch.diff) {
        console.warn('⚠️ jsondiffpatch not available, using simple diff fallback');
        return generateSimpleDiff(oldData, newData);
    }
    
    try {
        const delta = jsondiffpatch.diff(oldData, newData);
        return delta || null;
    } catch (e) {
        console.warn('⚠️ Diff generation failed, using simple diff fallback:', e.message);
        return generateSimpleDiff(oldData, newData);
    }
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
// 6. Load Data
// ============================

async function loadData() {
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
                appData = getDefaultData();
                saveSnapshot(appData);
                renderApp();
                if (loading) loading.style.display = 'none';
                if (root) root.style.display = 'block';
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        appData = JSON.parse(text);
        normalizeData(appData);

        // Initialize snapshot after data is loaded
        initializeSnapshot(appData);

        if (loading) loading.style.display = 'none';
        if (root) root.style.display = 'block';
        renderApp();

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
// 7. Default Data
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
// 8. Column Definitions (for filters)
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
// 9. Save Data to GitHub (with Gist for large data)
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

        // Generate diff
        const diff = generateDiff(lastSnapshot, data);
        
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

        // Determine if we need Gist (data > 40KB)
        const useGist = jsonStr.length > 40000;
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
                throw new Error(`Gist creation failed: ${errorData.message}`);
            }

            const gistData = await gistResponse.json();
            gistId = gistData.id;
            payloadType = 'gist';
            payloadData = ''; // Don't send data directly
            console.log(`✅ Gist created: ${gistId}`);
        }

        // Send payload
        const payload = {
            event_type: 'update-data',
            client_payload: {
                type: payloadType,
                gist_id: gistId,
                data: payloadData,
                snapshot_id: Date.now()
            }
        };

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
            if (response.status === 401) {
                clearGitHubToken();
                throw new Error('Token is invalid or expired. Please re-enter your Token.');
            }
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        // Save snapshot
        saveSnapshot(data);

        const sizeMsg = useGist 
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
// 10. Token Setup
// ============================

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
// 11. Get Current Scenario
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
// 12. Filter and Search
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
// 13. Render Functions (Table, Tree, RACI, etc.)
// ============================

// ... [REST OF YOUR RENDER FUNCTIONS REMAIN THE SAME]
// renderTable, renderSequence, renderRaciCheckboxes, etc.
// These are unchanged from your existing code

// ============================
// 14. Main Render App
// ============================

function renderApp() {
    const root = document.getElementById('app-root');
    if (!root) return;

    // Build UI if empty
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

            <!-- Modals -->
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

    // Update UI state
    updateUIVisibility();
    refreshScenarioDropdown();
    rebuildFilterUI();
    bindEvents();
    renderCurrentView();
}

// ============================
// 15. Event Binding
// ============================

let eventsBound = false;

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

    document.getElementById('filterColumnsConfirm').onclick = addFiltersFromSelection;
    document.getElementById('filterColumnsCancel').onclick = () => document.getElementById('filterColumnsModal').classList.remove('active');

    document.getElementById('masterImportFile').onchange = handleMasterImport;
    document.getElementById('processImportFile').onchange = handleProcessImport;

    document.getElementById('modalBusinessDoc').addEventListener('input', () => updateDocumentLinkIcon('modalBusinessDoc', 'businessDocLink'));
    document.getElementById('modalUserManual').addEventListener('input', () => updateDocumentLinkIcon('modalUserManual', 'userManualLink'));
}

// ============================
// 16. View Control
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

    ['addRowBtn', 'importProcessesBtn', 'saveDataBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isEdit ? 'inline-flex' : 'none';
    });

    const modeBtn = document.getElementById('modeToggleBtn');
    if (modeBtn) modeBtn.innerHTML = isEdit ? '👁️ Display Mode' : '✏️ Edit Mode';

    // Token status
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
// 17. Page Startup
// ============================

document.addEventListener('DOMContentLoaded', function() {
    const token = getGitHubToken();
    if (!token) {
        if (confirm('🔑 GitHub Token Required\n\nClick "OK" to enter your token, or "Cancel" to proceed in read-only mode.')) {
            showTokenSetup();
        }
    }
    loadData();
});

// ============================
// 18. Expose Global Functions
// ============================

window.toggleCollapse = toggleCollapse;
window.openProcessDetail = openProcessDetail;
window.saveDataToGitHub = saveDataToGitHub;
window.setupToken = showTokenSetup;
window.loadData = loadData;

// ============================
// 19. Placeholder functions for missing render functions
// (These should be replaced with your actual implementations)
// ============================

function renderTable() {
    // Your existing renderTable implementation
    console.log('renderTable called - implement with your code');
}

function renderSequence() {
    // Your existing renderSequence implementation
    console.log('renderSequence called - implement with your code');
}

function renderRaciCheckboxes(proc) {
    // Your existing renderRaciCheckboxes implementation
    console.log('renderRaciCheckboxes called - implement with your code');
}

function updateRaciDisplay(proc) {
    // Your existing updateRaciDisplay implementation
    console.log('updateRaciDisplay called - implement with your code');
}

function updateDocumentLinkIcon(inputId, linkIconId) {
    // Your existing updateDocumentLinkIcon implementation
    console.log('updateDocumentLinkIcon called - implement with your code');
}

function openProcessDetail(procId) {
    // Your existing openProcessDetail implementation
    console.log('openProcessDetail called - implement with your code');
}

function closeModal() {
    document.getElementById('processDetailModal').classList.remove('active');
}

function saveModal() {
    // Your existing saveModal implementation
    console.log('saveModal called - implement with your code');
}

function refreshMasterUI() {
    // Your existing refreshMasterUI implementation
    console.log('refreshMasterUI called - implement with your code');
}

function exportMasterCSV() {
    // Your existing exportMasterCSV implementation
    console.log('exportMasterCSV called - implement with your code');
}

function handleMasterImport(e) {
    // Your existing handleMasterImport implementation
    console.log('handleMasterImport called - implement with your code');
}

function exportProcesses() {
    // Your existing exportProcesses implementation
    console.log('exportProcesses called - implement with your code');
}

function importProcesses() {
    // Your existing importProcesses implementation
    console.log('importProcesses called - implement with your code');
}

function handleProcessImport(e) {
    // Your existing handleProcessImport implementation
    console.log('handleProcessImport called - implement with your code');
}

function showImportPreview(title, summary, headers, rows, cb) {
    // Your existing showImportPreview implementation
    console.log('showImportPreview called - implement with your code');
}

function closeImportPreview() {
    document.getElementById('importPreviewModal').classList.remove('active');
}

function openFilterColumnsModal() {
    // Your existing openFilterColumnsModal implementation
    console.log('openFilterColumnsModal called - implement with your code');
}

function addFiltersFromSelection() {
    // Your existing addFiltersFromSelection implementation
    console.log('addFiltersFromSelection called - implement with your code');
}

function rebuildFilterUI() {
    // Your existing rebuildFilterUI implementation
    console.log('rebuildFilterUI called - implement with your code');
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

function refreshScenarioDropdown() {
    const sel = document.getElementById('scenarioSelect');
    if (!sel) return;
    sel.innerHTML = '';
    appData.scenarios.forEach(sc => {
        const opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        if (sc.id === appData.currentScenarioId) opt.selected = true;
        sel.appendChild(opt);
    });
}

function addSubprocessWithInsertion(parent, seq, name) {
    // Your existing addSubprocessWithInsertion implementation
    console.log('addSubprocessWithInsertion called - implement with your code');
}

function autoIncrementSubprocess(parent) {
    // Your existing autoIncrementSubprocess implementation
    console.log('autoIncrementSubprocess called - implement with your code');
}

function confirmDelete(proc, scenario) {
    // Your existing confirmDelete implementation
    console.log('confirmDelete called - implement with your code');
}
