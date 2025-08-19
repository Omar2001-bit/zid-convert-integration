const fs = require('fs');
const path = require('path');

try {
  // This looks for 'serviceAccountKey.json' in the same folder as the script.
  const keyFilePath = path.join(__dirname, 'serviceAccountKey.json');

  // Reads the content of the file.
  const keyFileContent = fs.readFileSync(keyFilePath, 'utf8');

  // Parses the content into a JavaScript object.
  const parsedJson = JSON.parse(keyFileContent);

  // THIS IS THE MOST IMPORTANT STEP:
  // It converts the object back into a single-line string,
  // correctly escaping all special characters like newlines ('\n' becomes '\\n').
  const safeString = JSON.stringify(parsedJson);

  // --- Instructions ---
  console.log('\n✅ Your key is ready!');
  console.log('Copy the entire line of text between the markers below.');
  console.log('--- START COPYING HERE ---');
  console.log(safeString);
  console.log('--- END COPYING HERE ---');
  console.log('\nPaste this single line into the Render Secret File contents box.\n');

} catch (error) {
  console.error('\n❌ ERROR: Could not prepare the key.');
  console.error(error.message);
  console.error('\nPlease make sure "serviceAccountKey.json" is in the same directory as this script and contains the valid JSON key.\n');
}