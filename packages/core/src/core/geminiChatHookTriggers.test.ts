/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  triggerBeforeModelHook,
  triggerAfterModelHook,
  triggerBeforeToolSelectionHook,
} from './geminiChatHookTriggers.js';
import type { Config } from '../config/config.js';
import type { IContent } from '../services/history/IContent.js';

describe('geminiChatHookTriggers', () => {
  describe('triggerBeforeModelHook', () => {
    it('should return immediately when hooks are disabled', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(false),
      } as unknown as Config;

      const mockRequest = {
        contents: [] as IContent[],
      };

      await expect(
        triggerBeforeModelHook(mockConfig, mockRequest),
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

      const mockRequest = {
        contents: [
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'Hello' }],
          },
        ],
      };

      await expect(
        triggerBeforeModelHook(mockConfig, mockRequest),
      ).resolves.toBeUndefined();
    });

    it('should handle errors gracefully without propagating', async () => {
      // getHooks throws to force an error inside the try block
      // (HookRegistry.initialize() calls config.getHooks() during processHooksFromConfig)
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(true),
        getHooks: vi.fn().mockImplementation(() => {
          throw new Error('Test error');
        }),
      } as unknown as Config;

      const mockRequest = {
        contents: [] as IContent[],
      };

      await expect(
        triggerBeforeModelHook(mockConfig, mockRequest),
      ).resolves.toBeUndefined();
    });
  });

  describe('triggerAfterModelHook', () => {
    it('should return immediately when hooks are disabled', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(false),
      } as unknown as Config;

      const mockResponse: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello!' }],
      };

      await expect(
        triggerAfterModelHook(mockConfig, mockResponse),
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

      const mockResponse: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello!' }],
      };

      await expect(
        triggerAfterModelHook(mockConfig, mockResponse),
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

      const mockResponse: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello!' }],
      };

      await expect(
        triggerAfterModelHook(mockConfig, mockResponse),
      ).resolves.toBeUndefined();
    });
  });

  describe('triggerBeforeToolSelectionHook', () => {
    it('should return immediately when hooks are disabled', async () => {
      const mockConfig = {
        getEnableHooks: vi.fn().mockReturnValue(false),
      } as unknown as Config;

      await expect(
        triggerBeforeToolSelectionHook(mockConfig, []),
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
        triggerBeforeToolSelectionHook(mockConfig, []),
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
        triggerBeforeToolSelectionHook(mockConfig, []),
      ).resolves.toBeUndefined();
    });
  });
});
