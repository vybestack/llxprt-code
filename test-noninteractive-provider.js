#!/usr/bin/env node

// Test non-interactive mode with provider
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Check if OpenAI key exists
const apiKeyPath = path.join(os.homedir(), '.openai_key');
if (!fs.existsSync(apiKeyPath)) {
  console.log('Skipping test: No OpenAI API key found at ~/.openai_key');
  process.exit(0);
}

console.log('Testing non-interactive mode with provider...\n');

// First, we need to set the provider in the config
// Since non-interactive mode doesn't support slash commands, we need to test differently

// Test 1: Regular Gemini (baseline)
console.log('=== Test 1: Gemini (baseline) ===');
try {
  const result = execSync('gemini "what is the capital of France?"', {
    encoding: 'utf-8',
  });
  console.log(
    'Response:',
    result.includes('Paris')
      ? '✓ Correct answer received'
      : '✗ Unexpected response',
  );
} catch (error) {
  console.error('Error:', error.message);
}

console.log('\n=== Test 2: With GEMINI_PROVIDER env var ===');
// We could add support for GEMINI_PROVIDER env var to set the default provider
// For now, this will still use Gemini
try {
  const result = execSync('GEMINI_PROVIDER=openai gemini "what is 2+2?"', {
    encoding: 'utf-8',
    env: { ...process.env, GEMINI_PROVIDER: 'openai' },
  });
  console.log(
    'Response:',
    result.includes('4') ? '✓ Math answer received' : '✗ Unexpected response',
  );
} catch (error) {
  console.error('Error:', error.message);
}

console.log(
  '\nNote: Non-interactive mode currently always uses the default provider (Gemini).',
);
console.log('To test providers, use interactive mode with /provider command.');
