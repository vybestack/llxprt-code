/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'bun:test';
import { Config } from './config.js';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import fs from 'node:fs';

const __actual = { ...(await import('node:fs')) };
void vi.mock('node:fs', () => {
  const actual = __actual as typeof import('node:fs');
  const mockExistsSync = vi.fn();
  const mockStatSync = vi.fn();
  const mockExports = {
    ...actual,
    existsSync: mockExistsSync,
    statSync: mockStatSync,
  };
  // Source uses `import fs from 'node:fs'` (default import)
  return { ...mockExports, default: mockExports };
});

describe('Flash Model Fallback Configuration', () => {
  let config: Config;

  beforeEach(() => {
    (fs.existsSync as Mock<typeof fs.existsSync>).mockReturnValue(true);
    (fs.statSync as Mock<typeof fs.statSync>).mockReturnValue({
      isDirectory: () => true,
    } as fs.Stats);
    config = new Config({
      sessionId: 'test-session',
      targetDir: '/test',
      debugMode: false,
      cwd: '/test',
      model: 'gemini-2.5-pro',
      ideClient: IdeClient.getInstance(false),
    });

    // Initialize contentGeneratorConfig for testing
    (
      config as unknown as { contentGeneratorConfig: unknown }
    ).contentGeneratorConfig = {
      model: 'gemini-2.5-pro',
    };
  });

  // These tests do not actually test fallback. isInFallbackMode() only returns true,
  // when setFallbackMode is marked as true. This is to decouple setting a model
  // with the fallback mechanism. This will be necessary we introduce more
  // intelligent model routing.
  describe('setModel', () => {
    it('should only mark as switched if contentGeneratorConfig exists', () => {
      // Create config without initializing contentGeneratorConfig
      const newConfig = new Config({
        sessionId: 'test-session-2',
        targetDir: '/test',
        debugMode: false,
        cwd: '/test',
        model: 'gemini-2.5-pro',
        ideClient: IdeClient.getInstance(false),
      });

      // Should not crash when contentGeneratorConfig is undefined
      newConfig.setModel('gemini-2.5-flash');
      expect(newConfig.isInFallbackMode()).toBe(false);
    });
  });

  describe('getModel', () => {
    it('should return contentGeneratorConfig model if available', () => {
      // Simulate initialized content generator config
      config.setModel('gemini-2.5-flash');
      expect(config.getModel()).toBe('gemini-2.5-flash');
    });

    it('should fall back to initial model if contentGeneratorConfig is not available', () => {
      // Test with fresh config where contentGeneratorConfig might not be set
      const newConfig = new Config({
        sessionId: 'test-session-2',
        targetDir: '/test',
        debugMode: false,
        cwd: '/test',
        model: 'custom-model',
        ideClient: IdeClient.getInstance(false),
      });

      expect(newConfig.getModel()).toBe('custom-model');
    });
  });

  describe('isInFallbackMode', () => {
    it('should start as false for new session', () => {
      expect(config.isInFallbackMode()).toBe(false);
    });

    it('should remain false if no model switch occurs', () => {
      // Perform other operations that don't involve model switching
      expect(config.isInFallbackMode()).toBe(false);
    });

    it('should persist switched state throughout session', () => {
      config.setModel('gemini-2.5-flash');
      // Setting state for fallback mode as is expected of clients
      config.setFallbackMode(true);
      expect(config.isInFallbackMode()).toBe(true);

      // Should remain true even after getting model
      config.getModel();
      expect(config.isInFallbackMode()).toBe(true);
    });
  });
});
