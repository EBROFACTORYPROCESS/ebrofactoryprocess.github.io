// .github/scripts/update-data.js
const fs = require('fs');

console.log('=== Starting apply changes ===');

// Read current data.json
let currentData = {};
try {
  const content = fs.readFileSync('data.json', 'utf8');
  currentData = JSON.parse(content);
  console.log('Current data loaded, scenarios:', currentData.scenarios?.length || 0);
} catch (e) {
  console.log('No existing data.json, creating new one');
}

// Read payload
const payloadContent = fs.readFileSync('payload.json', 'utf8');
console.log('Payload content length:', payloadContent.length);

let payload;
try {
  payload = JSON.parse(payloadContent);
  console.log('Payload parsed successfully');
  console.log('Payload keys:', Object.keys(payload));
} catch (e) {
  console.error('Failed to parse payload.json:', e.message);
  process.exit(1);
}

const payloadType = payload.type || 'diff';
const gistId = payload.gist_id || '';
let fullData = null;

console.log('Payload type:', payloadType);
console.log('Gist ID:', gistId || '(none)');

// ============================================================
// ✅ FIXED: Properly apply diff with deletion support
// ============================================================
function applyDiff(current, diff) {
  console.log('Applying diff with deletion support...');
  
  // If diff is null or undefined, return current
  if (!diff) return current;
  
  // Deep clone the current data
  const result = JSON.parse(JSON.stringify(current));
  
  // Special handling for array operations
  if (diff._t === 'a') {
    console.log('Array diff detected');
    // For array diffs, we need to track deletions
    const arrayKeys = Object.keys(diff).filter(k => k !== '_t');
    const arrayOps = arrayKeys.map(k => {
      const val = diff[k];
      if (Array.isArray(val) && val.length === 2 && val[0] === 0) {
        // This is a deletion: [0, oldValue]
        return { type: 'delete', index: parseInt(k), value: val[1] };
      } else if (Array.isArray(val) && val.length === 2 && val[1] === 0) {
        // This is an insertion: [newValue, 0]
        return { type: 'insert', index: parseInt(k), value: val[0] };
      } else {
        return { type: 'update', index: parseInt(k), value: val };
      }
    });
    
    // Sort by index descending for deletions (to avoid shifting issues)
    const deletions = arrayOps.filter(op => op.type === 'delete').sort((a, b) => b.index - a.index);
    const insertions = arrayOps.filter(op => op.type === 'insert').sort((a, b) => a.index - b.index);
    const updates = arrayOps.filter(op => op.type === 'update');
    
    // Apply deletions first (from highest index to lowest)
    for (const del of deletions) {
      if (Array.isArray(result) && del.index < result.length) {
        console.log(`Deleting item at index ${del.index}`);
        result.splice(del.index, 1);
      }
    }
    
    // Apply insertions
    for (const ins of insertions) {
      if (Array.isArray(result)) {
        console.log(`Inserting item at index ${ins.index}`);
        result.splice(ins.index, 0, ins.value);
      }
    }
    
    // Apply updates
    for (const upd of updates) {
      if (Array.isArray(result) && upd.index < result.length) {
        console.log(`Updating item at index ${upd.index}`);
        if (upd.value && typeof upd.value === 'object') {
          result[upd.index] = applyDiff(result[upd.index], upd.value);
        } else {
          result[upd.index] = upd.value;
        }
      }
    }
    
    return result;
  }
  
  // For each key in the diff
  for (const key in diff) {
    if (key === '_t') continue;
    
    const diffValue = diff[key];
    const currentValue = result[key];
    
    // If the diff value is null or undefined, delete the key
    if (diffValue === null || diffValue === undefined) {
      console.log(`Deleting key: ${key}`);
      delete result[key];
      continue;
    }
    
    // Handle array diff format: [newValue, oldValue]
    if (Array.isArray(diffValue) && diffValue.length === 2) {
      // Check if it's a deletion: [0, oldValue] means delete
      if (diffValue[0] === 0) {
        console.log(`Deleting key (array diff): ${key}`);
        delete result[key];
        continue;
      }
      // Check if it's an insertion: [newValue, 0] means add/update
      if (diffValue[1] === 0) {
        console.log(`Setting key (array diff): ${key} to`, diffValue[0]);
        result[key] = diffValue[0];
        continue;
      }
    }
    
    // Recursively apply diff for nested objects
    if (diffValue && typeof diffValue === 'object' && !Array.isArray(diffValue)) {
      if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) {
        result[key] = {};
      }
      result[key] = applyDiff(result[key], diffValue);
    } else {
      // Direct assignment for primitive values
      console.log(`Setting key: ${key} to`, diffValue);
      result[key] = diffValue;
    }
  }
  
  return result;
}

// ============================================================
// FUNCTION: Extract value from diff format
// ============================================================
function extractValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value;
  
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    if (Array.isArray(last)) {
      return extractValue(last);
    }
    return extractValue(last);
  }
  
  if (value && typeof value === 'object') {
    const result = {};
    for (const key in value) {
      if (key === '_t') continue;
      result[key] = extractValue(value[key]);
    }
    return result;
  }
  
  return value;
}

// ============================================================
// FUNCTION: Clean a process
// ============================================================
function cleanProcess(p) {
  if (!p || typeof p !== 'object') return null;
  if (!p.id) return null;
  
  return {
    id: p.id,
    seq: p.seq || '0',
    name: p.name || 'Unnamed Process',
    description: p.description || '',
    raci: p.raci || { r: [], a: [], c: [], i: [] },
    businessStatus: p.businessStatus || 'Not Defined',
    system: p.system || { name: 'To Be Determined', status: 'Offline', responsible: '' },
    businessDoc: p.businessDoc || '',
    userManual: p.userManual || '',
    notes: p.notes || ''
  };
}

// ============================================================
// FUNCTION: Clean a scenario
// ============================================================
function cleanScenario(sc) {
  if (!sc || typeof sc !== 'object') return null;
  if (!sc.id) return null;
  
  const processes = Array.isArray(sc.processes) 
    ? sc.processes.map(p => cleanProcess(p)).filter(p => p !== null)
    : [];
  
  return {
    id: sc.id,
    name: sc.name || 'Scenario',
    processes: processes
  };
}

// ============================================================
// FUNCTION: Extract scenarios from diff
// ============================================================
function extractScenariosFromDiff(diff) {
  const extracted = [];
  
  // Case 1: diff.scenarios is an array
  if (diff.scenarios && Array.isArray(diff.scenarios)) {
    for (const item of diff.scenarios) {
      const extractedValue = extractValue(item);
      const scenario = cleanScenario(extractedValue);
      if (scenario) extracted.push(scenario);
    }
    return extracted;
  }
  
  // Case 2: diff.scenarios is an object
  if (diff.scenarios && typeof diff.scenarios === 'object') {
    const extractedValue = extractValue(diff.scenarios);
    
    if (Array.isArray(extractedValue)) {
      for (const item of extractedValue) {
        const scenario = cleanScenario(item);
        if (scenario) extracted.push(scenario);
      }
    } else if (extractedValue && typeof extractedValue === 'object') {
      if (extractedValue.id) {
        const scenario = cleanScenario(extractedValue);
        if (scenario) extracted.push(scenario);
      } else {
        for (const key in extractedValue) {
          if (key === '_t') continue;
          const value = extractedValue[key];
          if (value && typeof value === 'object' && value.id) {
            const scenario = cleanScenario(value);
            if (scenario) extracted.push(scenario);
          }
        }
      }
    }
  }
  
  // Case 3: diff itself is a scenario
  const selfScenario = cleanScenario(extractValue(diff));
  if (selfScenario) {
    extracted.push(selfScenario);
  }
  
  return extracted;
}

// ============================================================
// FUNCTION: Process Gist
// ============================================================
function processGist(gistId) {
  console.log('Fetching data from Gist:', gistId);
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not found');
    process.exit(1);
  }
  
  const gistUrl = 'https://api.github.com/gists/' + gistId;
  
  fetch(gistUrl, {
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json'
    }
  })
  .then(function(response) {
    if (!response.ok) {
      throw new Error('Gist API returned ' + response.status);
    }
    return response.json();
  })
  .then(function(gistData) {
    const files = gistData.files;
    const fileNames = Object.keys(files);
    if (fileNames.length === 0) {
      throw new Error('No files in gist');
    }
    const fileContent = files[fileNames[0]].content;
    console.log('Gist file content length:', fileContent.length);
    
    try {
      const parsedData = JSON.parse(fileContent);
      console.log('Gist data parsed successfully');
      console.log('Parsed data keys:', Object.keys(parsedData));
      applyChanges(parsedData);
    } catch (e) {
      console.error('Failed to parse Gist content:', e.message);
      process.exit(1);
    }
    
    return fetch('https://api.github.com/gists/' + gistId, {
      method: 'DELETE',
      headers: { 'Authorization': 'token ' + token }
    });
  })
  .then(function() {
    console.log('Gist deleted');
  })
  .catch(function(e) {
    console.error('Gist processing failed:', e.message);
    process.exit(1);
  });
}

// ============================================================
// ✅ FIXED: Apply changes with deletion support
// ============================================================
function applyChanges(parsedData) {
  console.log('Applying changes with deletion support...');
  
  // Step 1: Handle scenario deletions using applyDiff
  let resultData = applyDiff(currentData, parsedData);
  console.log('After applyDiff, scenarios:', resultData.scenarios?.length || 0);
  
  // Step 2: Ensure scenarios is an array
  if (!resultData.scenarios || !Array.isArray(resultData.scenarios)) {
    console.log('Scenarios is not an array, creating empty array');
    resultData.scenarios = [];
  }
  
  // Step 3: Clean all scenarios
  resultData.scenarios = resultData.scenarios
    .map(s => cleanScenario(s))
    .filter(s => s !== null);
  
  // Step 4: Handle currentScenarioId
  let newCurrentId = parsedData.currentScenarioId;
  if (newCurrentId) {
    const extractedId = extractValue(newCurrentId);
    if (extractedId && typeof extractedId === 'string') {
      const exists = resultData.scenarios.some(s => s && s.id === extractedId);
      if (exists) {
        resultData.currentScenarioId = extractedId;
        console.log('Set currentScenarioId to:', extractedId);
      }
    }
  }
  
  // Ensure currentScenarioId is valid
  if (!resultData.currentScenarioId || !resultData.scenarios.some(s => s && s.id === resultData.currentScenarioId)) {
    if (resultData.scenarios.length > 0) {
      resultData.currentScenarioId = resultData.scenarios[0].id;
      console.log('Set currentScenarioId to first scenario:', resultData.currentScenarioId);
    }
  }
  
  // Step 5: Ensure master data exists
  if (!resultData.departments || !Array.isArray(resultData.departments)) {
    resultData.departments = ['Sales', 'Production Planning', 'Material Planning', 'Material Handling', 'Purchase', 'Production Execution', 'Parts Quality', 'Vehicle Quality', 'Finance', 'Trade & Compliance'];
  }
  
  if (!resultData.sysNameList || !Array.isArray(resultData.sysNameList)) {
    resultData.sysNameList = ['SAP', 'LES', 'MES', 'KAPTURE', 'WMS', 'To Be Determined'];
  }
  
  if (!resultData.businessStatuses || !Array.isArray(resultData.businessStatuses)) {
    resultData.businessStatuses = [
      { value: 'Not Defined', color: 'red' },
      { value: 'In Progress', color: 'yellow' },
      { value: 'Completed', color: 'green' }
    ];
  }
  
  if (!resultData.sysStatusList || !Array.isArray(resultData.sysStatusList)) {
    resultData.sysStatusList = [
      { value: 'Operational', color: 'green' },
      { value: 'Completed', color: 'green' },
      { value: 'Offline', color: 'red' },
      { value: 'To Be Implemented', color: 'red' },
      { value: 'Work in Progress', color: 'yellow' }
    ];
  }
  
  if (!resultData.sysRespList || !Array.isArray(resultData.sysRespList)) {
    resultData.sysRespList = [];
  }
  
  console.log('Final scenarios count:', resultData.scenarios.length);
  console.log('Final currentScenarioId:', resultData.currentScenarioId);
  
  fs.writeFileSync('data.json', JSON.stringify(resultData, null, 2));
  console.log('data.json updated successfully');
}

// ============================================================
// MAIN EXECUTION
// ============================================================
if (payloadType === 'gist' && payload.gist_id) {
  processGist(payload.gist_id);
  setTimeout(function() {}, 30000);
} else {
  console.log('Processing direct payload...');
  let payloadData = payload.data || '';
  console.log('Payload data length:', payloadData.length);
  
  if (payloadData && payloadData.length > 0) {
    try {
      const parsedData = JSON.parse(payloadData);
      console.log('Direct payload parsed successfully');
      console.log('Parsed data keys:', Object.keys(parsedData));
      applyChanges(parsedData);
    } catch (e) {
      console.error('Failed to parse payload data:', e.message);
      console.log('Payload data preview:', payloadData.substring(0, 200));
      process.exit(1);
    }
  } else {
    console.error('No data found in payload');
    process.exit(1);
  }
}
