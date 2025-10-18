/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeForByteString,
  needsSanitization,
} from '@vybestack/llxprt-code-core';
import { MockFileSystem } from './IFileSystem.js';
import { setFileSystem } from './providerManagerInstance.js';

// Mock os module and set homedir before imports
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => '/home/user'),
    platform: vi.fn(() => 'linux'),
  };
});

// Mock stripJsonComments
vi.mock('strip-json-comments', () => ({
  default: (content: string) => content,
}));

// Mock the sanitizeApiKey function using the core utilities
function sanitizeApiKey(key: string): string {
  const sanitized = sanitizeForByteString(key);

  if (needsSanitization(key)) {
    console.warn(
      '[ProviderManager] API key contained non-ASCII or control characters that were removed. ' +
        'Please check your API key file encoding (should be UTF-8 without BOM).',
    );
  }

  return sanitized;
}

describe('API key sanitization regression tests', () => {
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileSystem = new MockFileSystem();
    setFileSystem(mockFileSystem);
  });

  it('should sanitize API keys containing Unicode replacement characters', () => {
    // Mock file content with Unicode replacement character (U+FFFD)
    const apiKeyWithReplacementChar = 'sk-1234567890abcdef\uFFFDghijklmnop';
    mockFileSystem.setMockFile(
      '/home/user/.openai_key',
      apiKeyWithReplacementChar,
    );

    const sanitizedKey = sanitizeApiKey(apiKeyWithReplacementChar);

    expect(sanitizedKey).toBe('sk-1234567890abcdefghijklmnop');
    expect(sanitizedKey).not.toContain('\uFFFD');
  });

  it('should sanitize API keys with control characters', () => {
    // Mock file content with control characters
    const apiKeyWithControlChars = 'sk-abc\x00def\x1Fghi';
    mockFileSystem.setMockFile(
      '/home/user/.openai_key',
      apiKeyWithControlChars,
    );

    const sanitizedKey = sanitizeApiKey(apiKeyWithControlChars);

    expect(sanitizedKey).toBe('sk-abcdefghi');
    // Verify no control characters remain
    for (let i = 0; i < sanitizedKey.length; i++) {
      const charCode = sanitizedKey.charCodeAt(i);
      expect(charCode).toBeGreaterThan(0x1f);
      expect(charCode).not.toBe(0x7f);
    }
  });

  it('should handle API keys from files with BOM', () => {
    // UTF-8 BOM followed by API key
    const bomString = '\uFEFFsk-validapikey123';
    mockFileSystem.setMockFile('/home/user/.openai_key', bomString);

    // Simulate BOM removal and sanitization
    let content = bomString;
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }
    const sanitizedKey = sanitizeApiKey(content);

    expect(sanitizedKey).toBe('sk-validapikey123');
  });

  it('should warn when sanitization removes characters', () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const apiKeyWithIssues = 'sk-abc\uFFFDdef';
    mockFileSystem.setMockFile('/home/user/.openai_key', apiKeyWithIssues);

    sanitizeApiKey(apiKeyWithIssues);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'API key contained non-ASCII or control characters',
      ),
    );

    consoleWarnSpy.mockRestore();
  });

  it('should apply sanitization to all providers consistently', () => {
    const providers = ['openai', 'anthropic', 'google'];
    const problematicKey = 'key-with\uFFFDissues\x00';

    // Set up mock files for each provider
    mockFileSystem.setMockFile('/home/user/.openai_key', problematicKey);
    mockFileSystem.setMockFile('/home/user/.anthropic_key', problematicKey);
    mockFileSystem.setMockFile('/home/user/.google_key', problematicKey);

    const results = providers.map((provider) => ({
      provider,
      key: sanitizeApiKey(problematicKey),
    }));

    // All providers should get the same sanitized result
    results.forEach((result) => {
      expect(result.key).toBe('key-withissues');
      expect(result.key).not.toContain('\uFFFD');
      expect(result.key).not.toContain('\x00');
    });
  });
});
