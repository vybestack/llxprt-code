/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  triggerBeforeToolHook,
  triggerAfterToolHook,
} from './coreToolHookTriggers.js';
import type { Config } from '../config/config.js';

describe('coreToolHookTriggers', () => {
  describe('triggerBeforeToolHook', () => {
    it('should return immediately when hooks are disabled', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(false),
      } as unknown as Config;

      // Should not throw and should return immediately
      await expect(
        triggerBeforeToolHook(mockConfig, 'test_tool', { arg1: 'value1' }),
      ).resolves.toBeUndefined();

      expect(mockConfig.getEnableHooks).toHaveBeenCalled();
    });

    it('should not throw when hooks are enabled (fire-and-forget)', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(true),
        getSessionId: vi.fn().mockReturnValue('test-session-id'),
        getWorkingDir: vi.fn().mockReturnValue('/test/cwd'),
        getHooks: vi.fn().mockReturnValue({}),
        getExtensions: vi.fn().mockReturnValue([]),
      } as unknown as Config;

      // Hook triggers are fire-and-forget, so should not throw
      await expect(
        triggerBeforeToolHook(mockConfig, 'test_tool', { arg1: 'value1' }),
      ).resolves.toBeUndefined();
    });

    it('should handle errors gracefully without propagating', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(true),
        getSessionId: vi.fn().mockImplementation(() => {
          throw new Error('Test error');
        }),
        getWorkingDir: vi.fn().mockReturnValue('/test/cwd'),
      } as unknown as Config;

      // Errors should be caught and logged, not propagated
      await expect(
        triggerBeforeToolHook(mockConfig, 'test_tool', { arg1: 'value1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('triggerAfterToolHook', () => {
    it('should return immediately when hooks are disabled', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(false),
      } as unknown as Config;

      await expect(
        triggerAfterToolHook(
          mockConfig,
          'test_tool',
          { arg1: 'value1' },
          { result: 'success' },
        ),
      ).resolves.toBeUndefined();

      expect(mockConfig.getEnableHooks).toHaveBeenCalled();
    });

    it('should not throw when hooks are enabled (fire-and-forget)', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(true),
        getSessionId: vi.fn().mockReturnValue('test-session-id'),
        getWorkingDir: vi.fn().mockReturnValue('/test/cwd'),
        getHooks: vi.fn().mockReturnValue({}),
        getExtensions: vi.fn().mockReturnValue([]),
      } as unknown as Config;

      await expect(
        triggerAfterToolHook(
          mockConfig,
          'test_tool',
          { arg1: 'value1' },
          { result: 'success' },
        ),
      ).resolves.toBeUndefined();
    });

    it('should handle errors gracefully without propagating', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(true),
        getSessionId: vi.fn().mockImplementation(() => {
          throw new Error('Test error');
        }),
        getWorkingDir: vi.fn().mockReturnValue('/test/cwd'),
      } as unknown as Config;

      await expect(
        triggerAfterToolHook(
          mockConfig,
          'test_tool',
          { arg1: 'value1' },
          { result: 'success' },
        ),
      ).resolves.toBeUndefined();
    });
  });
});
