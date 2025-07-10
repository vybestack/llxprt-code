#!/bin/bash

echo "Testing provider integration..."
echo ""

# Test non-interactive mode with Gemini
echo "=== Testing non-interactive mode with Gemini ==="
echo "Running: gemini 'what is 2+2?'"
gemini "what is 2+2?" 2>&1 | head -5

echo ""
echo "=== Testing non-interactive mode with OpenAI provider ==="
echo "Setting up provider and testing..."

# Create a test script that sets provider and runs command
cat > test-provider-noninteractive.js << 'EOF'
#!/usr/bin/env node
import { spawn } from 'child_process';

const gemini = spawn('gemini', [], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';

gemini.stdout.on('data', (data) => {
  output += data.toString();
});

gemini.stderr.on('data', (data) => {
  console.error(data.toString());
});

gemini.on('close', (code) => {
  console.log('Output:', output.includes('2') && output.includes('4') ? 'Math response received' : 'No math response');
  process.exit(code);
});

// Send commands
setTimeout(() => {
  gemini.stdin.write('/provider openai\n');
}, 500);

setTimeout(() => {
  gemini.stdin.write('what is 2+2?\n');
}, 1000);

setTimeout(() => {
  gemini.stdin.write('/exit\n');
}, 2000);
EOF

node test-provider-noninteractive.js

# Cleanup
rm test-provider-noninteractive.js

echo ""
echo "=== Testing interactive mode with tools ==="
cat > test-provider-tools.js << 'EOF'
#!/usr/bin/env node
import { spawn } from 'child_process';

const gemini = spawn('gemini', ['--debug'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let debugOutput = '';

gemini.stdout.on('data', (data) => {
  process.stdout.write(data);
});

gemini.stderr.on('data', (data) => {
  debugOutput += data.toString();
});

gemini.on('close', (code) => {
  console.log('\n=== Debug Analysis ===');
  
  const checks = [
    { pattern: /USE_PROVIDER auth type/, name: 'Provider auth type used' },
    { pattern: /ProviderContentGenerator/, name: 'ProviderContentGenerator created' },
    { pattern: /Tool call received/, name: 'Tool calls working' },
  ];
  
  checks.forEach((check) => {
    const found = check.pattern.test(debugOutput);
    console.log(`${found ? '✓' : '✗'} ${check.name}`);
  });
});

// Send commands
setTimeout(() => {
  gemini.stdin.write('/provider openai\n');
}, 500);

setTimeout(() => {
  gemini.stdin.write('list the current directory\n');
}, 1500);

setTimeout(() => {
  gemini.stdin.write('/exit\n');
}, 4000);
EOF

node test-provider-tools.js

# Cleanup
rm test-provider-tools.js