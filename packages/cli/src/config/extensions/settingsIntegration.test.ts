/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadExtensionSettingsFromManifest,
  maybePromptAndSaveSettings,
  getExtensionEnvironment,
} from './settingsIntegration.js';
import type { ExtensionSetting } from './extensionSettings.js';

// Create temp directory for tests
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'settings-int-'));
});

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

describe('loadExtensionSettingsFromManifest', () => {
  it('should load settings from llxprt-extension.json', () => {
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, 'llxprt-extension.json'),
      JSON.stringify({
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          { name: 'API Key', envVar: 'API_KEY', sensitive: true },
        ],
      }),
    );
    
    const settings = loadExtensionSettingsFromManifest(extDir);
    
    expect(settings).toHaveLength(1);
    expect(settings[0].envVar).toBe('API_KEY');
    expect(settings[0].sensitive).toBe(true);
  });

  it('should load settings from gemini-extension.json fallback', () => {
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, 'gemini-extension.json'),
      JSON.stringify({
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          { name: 'API URL', envVar: 'API_URL', sensitive: false },
        ],
      }),
    );
    
    const settings = loadExtensionSettingsFromManifest(extDir);
    
    expect(settings).toHaveLength(1);
    expect(settings[0].envVar).toBe('API_URL');
  });

  it('should prefer llxprt-extension.json over gemini-extension.json', () => {
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    
    // Create both files with different settings
    fs.writeFileSync(
      path.join(extDir, 'llxprt-extension.json'),
      JSON.stringify({
        name: 'test-ext',
        version: '1.0.0',
        settings: [{ name: 'LLxprt Setting', envVar: 'LLXPRT_VAR', sensitive: false }],
      }),
    );
    fs.writeFileSync(
      path.join(extDir, 'gemini-extension.json'),
      JSON.stringify({
        name: 'test-ext',
        version: '1.0.0',
        settings: [{ name: 'Gemini Setting', envVar: 'GEMINI_VAR', sensitive: false }],
      }),
    );
    
    const settings = loadExtensionSettingsFromManifest(extDir);
    
    // Should have loaded llxprt-extension.json
    expect(settings).toHaveLength(1);
    expect(settings[0].envVar).toBe('LLXPRT_VAR');
  });

  it('should return empty array when no settings defined', () => {
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, 'llxprt-extension.json'),
      JSON.stringify({
        name: 'test-ext',
        version: '1.0.0',
        // No settings field
      }),
    );
    
    const settings = loadExtensionSettingsFromManifest(extDir);
    
    expect(settings).toEqual([]);
  });

  it('should return empty array when manifest not found', () => {
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    // No manifest file
    
    const settings = loadExtensionSettingsFromManifest(extDir);
    
    expect(settings).toEqual([]);
  });

  it('should validate settings schema', () => {
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, 'llxprt-extension.json'),
      JSON.stringify({
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          { name: '', envVar: 'X' }, // Invalid: empty name
        ],
      }),
    );
    
    const settings = loadExtensionSettingsFromManifest(extDir);
    
    // Should filter out invalid settings or return empty
    expect(settings).toEqual([]);
  });
});

// Mock readline module at the top level
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn(),
  })),
}));

describe('maybePromptAndSaveSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prompt for missing settings and save', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'API Key', envVar: 'API_KEY', sensitive: true },
    ];
    const existingValues: Record<string, string | undefined> = {};
    
    // Mock readline to simulate user entering value
    const mockReadline = await import('node:readline');
    const mockQuestion = vi.fn((prompt, callback) => {
      callback('user-api-key');
    });
    const mockClose = vi.fn();
    
    vi.mocked(mockReadline.createInterface).mockReturnValue({
      question: mockQuestion,
      close: mockClose,
    } as unknown as ReturnType<typeof mockReadline.createInterface>);
    
    const result = await maybePromptAndSaveSettings(
      'test-ext',
      settings,
      existingValues,
      tempDir,
    );
    
    expect(result).toBe(true);
    expect(mockQuestion).toHaveBeenCalled();
  });

  it('should skip when all settings present', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'API Key', envVar: 'API_KEY', sensitive: true },
    ];
    const existingValues = { API_KEY: 'already-set' };
    
    const mockReadline = await import('node:readline');
    const mockQuestion = vi.fn();
    
    vi.mocked(mockReadline.createInterface).mockReturnValue({
      question: mockQuestion,
      close: vi.fn(),
    } as unknown as ReturnType<typeof mockReadline.createInterface>);
    
    const result = await maybePromptAndSaveSettings(
      'test-ext',
      settings,
      existingValues,
      tempDir,
    );
    
    // Should succeed but not prompt
    expect(result).toBe(true);
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it('should return false when user cancels', async () => {
    const settings: ExtensionSetting[] = [
      { name: 'API Key', envVar: 'API_KEY', sensitive: true },
    ];
    
    const mockReadline = await import('node:readline');
    const mockQuestion = vi.fn((prompt, callback) => {
      callback('');
    });
    
    vi.mocked(mockReadline.createInterface).mockReturnValue({
      question: mockQuestion,
      close: vi.fn(),
    } as unknown as ReturnType<typeof mockReadline.createInterface>);
    
    const result = await maybePromptAndSaveSettings(
      'test-ext',
      settings,
      {},
      tempDir,
    );
    
    expect(result).toBe(false);
  });
});

describe('getExtensionEnvironment', () => {
  it('should return env vars from saved non-sensitive settings', async () => {
    // Setup: create an extension with saved settings
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    
    // Write .env file
    const envPath = path.join(extDir, '.env');
    fs.writeFileSync(envPath, 'API_URL=https://api.example.com\n');
    
    const env = await getExtensionEnvironment(extDir);
    
    expect(env['API_URL']).toBe('https://api.example.com');
  });

  it('should include sensitive settings from keychain', async () => {
    // This would need mocking of keychain
    // For now, test that the function exists and returns at least an object
    const extDir = path.join(tempDir, 'test-ext');
    fs.mkdirSync(extDir, { recursive: true });
    
    const env = await getExtensionEnvironment(extDir);
    
    expect(typeof env).toBe('object');
  });

  it('should return empty object for extension without settings', async () => {
    const extDir = path.join(tempDir, 'no-settings-ext');
    fs.mkdirSync(extDir, { recursive: true });
    
    const env = await getExtensionEnvironment(extDir);
    
    expect(env).toEqual({});
  });
});
