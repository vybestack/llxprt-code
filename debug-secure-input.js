// Debug script to test secure input handling with CR
import { secureInputHandler } from './packages/cli/dist/ui/utils/secureInputHandler.js';

console.log('Testing secure input handler with CR...\n');

// Test 1: Normal input
const test1 = '/key mySecretKey123';
const result1 = secureInputHandler.processInput(test1);
console.log('Test 1 - Normal input:');
console.log('  Input:', JSON.stringify(test1));
console.log('  Output:', JSON.stringify(result1));
console.log('  Is secure:', secureInputHandler.isInSecureMode());
console.log();

// Test 2: Input with CR
const test2 = '/key mySecretKey123\r';
const result2 = secureInputHandler.processInput(test2);
console.log('Test 2 - Input with CR:');
console.log('  Input:', JSON.stringify(test2));
console.log('  Output:', JSON.stringify(result2));
console.log('  Is secure:', secureInputHandler.isInSecureMode());
console.log();

// Test 3: Input with LF
const test3 = '/key mySecretKey123\n';
const result3 = secureInputHandler.processInput(test3);
console.log('Test 3 - Input with LF:');
console.log('  Input:', JSON.stringify(test3));
console.log('  Output:', JSON.stringify(result3));
console.log('  Is secure:', secureInputHandler.isInSecureMode());
console.log();

// Test 4: Progressive input then paste with CR
secureInputHandler.reset();
const step1 = '/key ';
const resultStep1 = secureInputHandler.processInput(step1);
console.log('Test 4 - Progressive input:');
console.log('  Step 1 - Type "/key ":');
console.log('    Input:', JSON.stringify(step1));
console.log('    Output:', JSON.stringify(resultStep1));
console.log();

const step2 = '/key mySecretKey123\r';
const resultStep2 = secureInputHandler.processInput(step2);
console.log('  Step 2 - Paste with CR:');
console.log('    Input:', JSON.stringify(step2));
console.log('    Output:', JSON.stringify(resultStep2));
console.log(
  '    Actual value:',
  JSON.stringify(secureInputHandler.getActualValue()),
);
