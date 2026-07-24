const fs = require('fs');

console.log('=== Starting apply changes ===');

// Read current data.json
let currentData = {};
try {
  const content = fs.readFileSync('data.json', 'utf8');
  currentData = JSON.parse(content);
  console.log('Current data loaded, size:', Object.keys(currentData).length);
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
      fullData = JSON.parse(fileContent);
      console.log('Data parsed successfully');
      
      // ✅ Save the FULL data directly (not a diff)
      fs.writeFileSync('data.json', JSON.stringify(fullData, null, 2));
      console.log('✅ data.json updated successfully (full data from Gist)');
      
      // Clean up - delete the gist
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
  
} else {
  // ============================================================
  // CASE 2: Direct diff payload
  // ============================================================
  console.log('Processing direct payload...');
  let payloadData = payload.data || '';
  
  if (payloadData && payloadData.length > 0) {
    try {
      const parsedDiff = JSON.parse(payloadData);
      console.log('Diff parsed successfully');
      
      // ✅ IMPORTANT: Check if this is a FULL data or a DIFF
      // If it has 'scenarios' and 'departments', it's likely full data
      if (parsedDiff.scenarios && parsedDiff.departments) {
        // This is FULL data - save it directly
        fullData = parsedDiff;
        console.log('✅ Full data detected, saving directly');
      } else {
        // This is a DIFF - apply it to current data
        console.log('✅ Diff detected, applying to current data');
        // Use the diff package to apply changes
        const { diffJson, applyPatch } = require('diff');
        const patch = diffJson(currentData, parsedDiff);
        fullData = applyPatch(currentData, patch);
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
  
  if (fullData) {
    // ✅ Validate the data has the required structure
    if (!fullData.scenarios || !Array.isArray(fullData.scenarios)) {
      console.error('❌ Invalid data: missing scenarios array');
      console.log('Data keys:', Object.keys(fullData));
      process.exit(1);
    }
    
    fs.writeFileSync('data.json', JSON.stringify(fullData, null, 2));
    console.log('✅ data.json updated successfully');
  }
}
