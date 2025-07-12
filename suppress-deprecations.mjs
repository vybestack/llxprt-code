#!/usr/bin/env node
/* eslint-env node */

// This script demonstrates different methods to suppress deprecation warnings

console.log('=== Method 1: Using process.removeAllListeners ===');
console.log('Add this at the beginning of your application:\n');
console.log(`process.removeAllListeners('warning');`);
console.log(`// or more selectively:`);
console.log(`process.on('warning', (warning) => {`);
console.log(`  if (warning.name === 'DeprecationWarning' && `);
console.log(`      (warning.message.includes('punycode') || warning.message.includes('url.parse'))) {`);
console.log(`    return; // Ignore these specific warnings`);
console.log(`  }`);
console.log(`  console.warn(warning); // Show other warnings`);
console.log(`});\n`);

console.log('=== Method 2: Using NODE_NO_WARNINGS environment variable ===');
console.log('Run your application with:\n');
console.log(`NODE_NO_WARNINGS=1 node your-app.js`);
console.log(`# or for Windows:`);
console.log(`set NODE_NO_WARNINGS=1 && node your-app.js\n`);

console.log('=== Method 3: Using NODE_OPTIONS ===');
console.log('Set the environment variable:\n');
console.log(`export NODE_OPTIONS="--no-deprecation"`);
console.log(`# or for a specific run:`);
console.log(`NODE_OPTIONS="--no-deprecation" node your-app.js\n`);

console.log('=== Method 4: Using process.noDeprecation ===');
console.log('Add this at the beginning of your application:\n');
console.log(`process.noDeprecation = true;\n`);

console.log('=== Method 5: Creating a wrapper script ===');
console.log('Create a wrapper that suppresses warnings before loading the main app:\n');
console.log(`// suppress-warnings.js`);
console.log(`process.removeAllListeners('warning');`);
console.log(`require('./main-app.js');\n`);