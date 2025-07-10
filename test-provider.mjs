#!/usr/bin/env node

// Quick test of OpenAI provider
import { spawn } from 'child_process';

const gemini = spawn('gemini', ['--debug'], {
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let debugOutput = '';

gemini.stdout.on('data', (data) => {
  process.stdout.write(data);
});

gemini.stderr.on('data', (data) => {
  debugOutput += data.toString();
  process.stderr.write(data);
});

gemini.on('close', (code) => {
  console.log(`\nGemini exited with code ${code}`);

  // Check if we saw key debug messages
  const checks = [
    { pattern: /Using provider for message/, name: 'Provider activation' },
    { pattern: /Tools provided: \d+/, name: 'Tools passed to provider' },
    {
      pattern: /OpenAIProvider.*generateChatCompletion called/,
      name: 'OpenAI called',
    },
    { pattern: /tool_choice/, name: 'Tool choice parameter' },
  ];

  console.log('\nDebug checks:');
  checks.forEach((check) => {
    const found = check.pattern.test(debugOutput);
    console.log(`${found ? '✓' : '✗'} ${check.name}`);
  });
});

// Send commands
setTimeout(() => {
  gemini.stdin.write('/provider openai\n');
}, 1000);

setTimeout(() => {
  gemini.stdin.write('list the current directory\n');
}, 2000);

setTimeout(() => {
  gemini.stdin.write('/exit\n');
}, 5000);
