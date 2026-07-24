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
// FUNCTION: Apply diff manually (no external dependencies)
// ============================================================
function applyDiff(current, diff) {
  console.log('Applying diff manually...');
  // Deep clone the current data
  const result = JSON.parse(JSON.stringify(current));
  
  // For each key in the diff
  for (const key in diff) {
    if (key === '_t') continue; // Skip array marker
    
    const diffValue = diff[key];
    const currentValue = result[key];
    
    // If the diff value is an object and not an array, recursively merge
    if (diffValue && typeof diffValue === 'object' && !Array.isArray(diffValue)) {
      if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) {
        result[key] = {};
      }
      result[key] = applyDiff(result[key], diffValue);
    } else {
      // Direct assignment for primitive values or arrays
      result[key] = diffValue;
    }
  }
  
  return result;
}

// ============================================================
// CASE 1: Gist payload (large data)
// ============================================================
if (payloadType === 'gist' && gistId && gistId.length > 0) {
  console.log('📥 Downloading data from Gist:', gistId);
  
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not found in environment');
    process.exit(1);
  }
  
  const gistUrl = `https://api.github.com/gists/${gistId}`;
  
  (async function() {
    try {
      const response = await fetch(gistUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'BPO-Workflow'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Gist API returned ${response.status}`);
      }
      
      const gistData = await response.json();
      const files = gistData.files;
      const fileNames = Object.keys(files);
      if (fileNames.length === 0) {
        throw new Error('No files found in gist');
      }
      
      const fileContent = files[fileNames[0]].content;
      console.log('Downloaded data length:', fileContent.length);
      const diffData = JSON.parse(fileContent);
      console.log('Diff parsed successfully');
      
      // Apply the diff to current data
      fullData = applyDiff(currentData, diffData);
      
      // Validate
      if (!fullData.scenarios || !Array.isArray(fullData.scenarios)) {
        console.error('❌ Invalid merged data: missing scenarios array');
        console.log('Data keys:', Object.keys(fullData));
        process.exit(1);
      }
      
      fs.writeFileSync('data.json', JSON.stringify(fullData, null, 2));
      console.log('✅ data.json updated successfully (merged from Gist diff)');
      
      // Clean up
      if (token && gistId) {
        console.log('🗑️ Deleting temporary Gist...');
        try {
          const deleteResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          if (deleteResponse.ok) {
            console.log('✅ Gist deleted');
          }
        } catch (e) {
          console.log('⚠️ Could not delete Gist:', e.message);
        }
      }
    } catch (e) {
      console.error('Failed to process gist:', e.message);
      process.exit(1);
    }
  })();
  
  setTimeout(() => {}, 30000);
  return;
}

// ============================================================
// CASE 2: Direct diff payload
// ============================================================
else {
  console.log('Processing direct payload...');
  let payloadData = payload.data || '';
  
  if (payloadData && payloadData.length > 0) {
    try {
      const parsedData = JSON.parse(payloadData);
      console.log('Payload parsed successfully');
      
      // Check if this is already FULL data
      if (parsedData.scenarios && Array.isArray(parsedData.scenarios)) {
        fullData = parsedData;
        console.log('✅ Full data detected, saving directly');
      } else {
        // This is a DIFF - apply it
        console.log('✅ Diff detected, applying to current data');
        fullData = applyDiff(currentData, parsedData);
        console.log('Diff applied successfully');
      }
    } catch (e) {
      console.error('Failed to parse payload data:', e.message);
      process.exit(1);
    }
  } else {
    console.error('No data found in payload');
    process.exit(1);
  }
}

// ============================================================
// VALIDATE AND SAVE
// ============================================================
if (fullData) {
  // Ensure scenarios is an array
  if (!fullData.scenarios || !Array.isArray(fullData.scenarios)) {
    console.error('❌ Invalid data: scenarios is not an array');
    console.log('Current scenarios type:', typeof fullData.scenarios);
    
    // If scenarios is an object with numeric keys, convert it to array
    if (fullData.scenarios && typeof fullData.scenarios === 'object') {
      const scenarioObj = fullData.scenarios;
      const scenarioArray = [];
      
      for (const key in scenarioObj) {
        if (key === '_t') continue;
        const value = scenarioObj[key];
        
        // Try to extract a scenario from the object
        if (value && typeof value === 'object') {
          const scenario = { id: 'default', name: 'Manufacturing', processes: [] };
          
          // Extract id
          if (value.id) {
            scenario.id = Array.isArray(value.id) ? value.id[0] : value.id;
          }
          // Extract name
          if (value.name) {
            scenario.name = Array.isArray(value.name) ? value.name[0] : value.name;
          }
          // Extract processes
          if (value.processes && typeof value.processes === 'object') {
            const processArray = [];
            for (const pKey in value.processes) {
              if (pKey === '_t') continue;
              const pVal = value.processes[pKey];
              if (Array.isArray(pVal) && pVal.length > 0) {
                processArray.push(pVal[0]);
              } else if (pVal && typeof pVal === 'object' && pVal.id) {
                processArray.push(pVal);
              }
            }
            scenario.processes = processArray;
          }
          
          if (scenario.id || scenario.processes.length > 0) {
            scenarioArray.push(scenario);
          }
        }
      }
      
      if (scenarioArray.length > 0) {
        fullData.scenarios = scenarioArray;
        console.log('✅ Extracted scenarios from object, count:', scenarioArray.length);
      } else {
        fullData.scenarios = [{
          id: 'default',
          name: 'Manufacturing',
          processes: []
        }];
        console.log('⚠️ Created default scenario');
      }
    } else {
      fullData.scenarios = [{
        id: 'default',
        name: 'Manufacturing',
        processes: []
      }];
      console.log('⚠️ Created default scenario');
    }
  }
  
  // Ensure currentScenarioId exists
  if (!fullData.currentScenarioId) {
    if (fullData.scenarios && fullData.scenarios.length > 0) {
      fullData.currentScenarioId = fullData.scenarios[0].id || 'default';
    } else {
      fullData.currentScenarioId = 'default';
    }
  }
  
  // Ensure departments exists
  if (!fullData.departments || !Array.isArray(fullData.departments)) {
    fullData.departments = ['Sales', 'Production Planning', 'Material Planning', 'Material Handling', 'Purchase', 'Production Execution', 'Parts Quality', 'Vehicle Quality', 'Finance', 'Trade & Compliance'];
  }
  
  // Ensure sysNameList exists
  if (!fullData.sysNameList || !Array.isArray(fullData.sysNameList)) {
    fullData.sysNameList = ['SAP', 'LES', 'MES', 'KAPTURE', 'WMS', 'To Be Determined'];
  }
  
  // Ensure businessStatuses exists
  if (!fullData.businessStatuses || !Array.isArray(fullData.businessStatuses)) {
    fullData.businessStatuses = [
      { value: 'Not Defined', color: 'red' },
      { value: 'In Progress', color: 'yellow' },
      { value: 'Completed', color: 'green' }
    ];
  }
  
  // Ensure sysStatusList exists
  if (!fullData.sysStatusList || !Array.isArray(fullData.sysStatusList)) {
    fullData.sysStatusList = [
      { value: 'Operational', color: 'green' },
      { value: 'Completed', color: 'green' },
      { value: 'Offline', color: 'red' },
      { value: 'To Be Implemented', color: 'red' },
      { value: 'Work in Progress', color: 'yellow' }
    ];
  }
  
  fs.writeFileSync('data.json', JSON.stringify(fullData, null, 2));
  console.log('✅ data.json updated successfully');
  console.log('Final scenarios count:', fullData.scenarios?.length || 0);
} else {
  console.log('No data to save');
  process.exit(1);
}
