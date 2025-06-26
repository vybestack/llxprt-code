#!/usr/bin/env node

// Test that provider setup doesn't crash
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

async function testProvider() {
  console.log('Testing provider setup...\n');

  const gemini = spawn('gemini', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  let errorOutput = '';
  let crashed = false;

  gemini.stdout.on('data', (data) => {
    output += data.toString();
    process.stdout.write(data);
  });

  gemini.stderr.on('data', (data) => {
    errorOutput += data.toString();
    if (
      data.toString().includes('ERROR') &&
      data.toString().includes('paths[0]')
    ) {
      crashed = true;
      console.error('\n❌ CRASH DETECTED: Tool description error\n');
    }
  });

  // Wait a moment for initialization
  await setTimeout(1000);

  // Try switching to OpenAI provider
  console.log('\nSwitching to OpenAI provider...\n');
  gemini.stdin.write('/provider openai\n');

  await setTimeout(500);

  // Try to trigger tool description rendering
  console.log('\nTesting tool rendering...\n');
  gemini.stdin.write('list the current directory\n');

  await setTimeout(2000);

  // Exit
  gemini.stdin.write('/exit\n');

  await new Promise((resolve) => {
    gemini.on('close', resolve);
  });

  console.log('\n=== Test Results ===');
  if (crashed) {
    console.log('❌ Test FAILED - Tool description crash detected');
    process.exit(1);
  } else if (errorOutput.includes('ERROR')) {
    console.log('⚠️  Test completed with errors (but no crash)');
    console.log('Error output:', errorOutput.slice(0, 200));
  } else {
    console.log('✅ Test PASSED - No tool description crashes');
  }

  if (output.includes('Switched from gemini to openai')) {
    console.log('✅ Provider switch successful');
  } else {
    console.log('❌ Provider switch may have failed');
  }
}

testProvider().catch(console.error);
