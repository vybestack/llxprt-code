#!/usr/bin/env node

// Test what happens when llxprt starts up with no prompts
import { GeminiClient } from './packages/core/dist/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function testStartup() {
  console.log('Testing startup with no prompts...');

  const promptsDir = path.join(os.homedir(), '.llxprt', 'prompts');

  // Clean prompts directory
  if (fs.existsSync(promptsDir)) {
    fs.rmSync(promptsDir, { recursive: true, force: true });
  }

  console.log(`Prompts directory exists: ${fs.existsSync(promptsDir)}`);

  try {
    // Create a mock config
    const mockConfig = {
      selectedModel: 'gemini-2.5-flash',
      debugMode: true,
      getToolRegistry: async () => ({ getAllTools: () => [] }),
      getProxy: () => undefined,
      selectedAuthType: 'api_key',
      apiKey: 'test-key',
    };

    // Create client (this should trigger prompt initialization via startChat)
    const client = new GeminiClient(mockConfig, {
      debug: true,
      onProgress: () => {},
    });

    console.log('Created GeminiClient, now starting chat...');

    // This should call getCoreSystemPromptAsync internally
    await client.startChat();

    console.log('Chat started successfully');

    // Check if files were installed
    const files = [
      'core.md',
      'providers/gemini/models/gemini-2.5-flash/core.md',
    ];

    for (const file of files) {
      const filePath = path.join(promptsDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        console.log(`✅ File exists: ${file} (${content.length} bytes)`);
      } else {
        console.log(`❌ File missing: ${file}`);
      }
    }
  } catch (error) {
    console.error('Error during startup:', error);
  }
}

testStartup().catch(console.error);
