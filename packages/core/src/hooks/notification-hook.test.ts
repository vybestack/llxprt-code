/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for Notification hook (ToolPermission).
 *
 * Tests verify that when a tool requires user confirmation, the Notification
 * hook fires with the correct payload before showing the confirmation dialog.
 *
 * Test philosophy (per dev-docs/RULES.md):
 * - Tests are behavioral (input → output), not mock-interaction tests
 * - Tests verify actual outcomes, not implementation details
 * - Every line of production code is written in response to a failing test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerToolNotificationHook } from '../core/coreToolHookTriggers.js';
import { NotificationType } from './types.js';
import type { Config } from '../config/config.js';
import { HookSystem } from './hookSystem.js';
import type { ToolCallConfirmationDetails } from '../tools/tools.js';

describe('Notification Hook (ToolPermission)', () => {
  let mockConfig: Config;
  let mockHookSystem: HookSystem;

  beforeEach(() => {
    mockHookSystem = {
      initialize: vi.fn(async () => {}),
      fireNotificationEvent: vi.fn(async () => ({})),
    } as unknown as HookSystem;

    mockConfig = {
      getEnableHooks: vi.fn(() => true),
      getHookSystem: vi.fn(() => mockHookSystem),
    } as unknown as Config;
  });

  describe('triggerToolNotificationHook', () => {
    it('should fire Notification hook with ToolPermission type for edit confirmation', async () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'edit',
        title: 'Write to test.txt',
        fileName: 'test.txt',
        filePath: '/tmp/test.txt',
        fileDiff: '+new content',
        originalContent: '',
        newContent: 'new content',
        isModifying: false,
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        mockConfig,
        confirmationDetails,
      );

      expect(result).toBeDefined();
      expect(result?.notificationType).toBe(NotificationType.ToolPermission);
      expect(result?.message).toContain('Write to test.txt');
      expect(result?.details.type).toBe('edit');
      expect(result?.details.title).toBe('Write to test.txt');
    });

    it('should fire Notification hook with ToolPermission type for exec confirmation', async () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Run shell command',
        command: 'rm -rf /',
        rootCommand: 'rm',
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        mockConfig,
        confirmationDetails,
      );

      expect(result).toBeDefined();
      expect(result?.notificationType).toBe(NotificationType.ToolPermission);
      expect(result?.message).toContain('Run shell command');
      expect(result?.details.type).toBe('exec');
      expect(result?.details.command).toBe('rm -rf /');
    });

    it('should return undefined when hooks are disabled', async () => {
      const disabledConfig = {
        getEnableHooks: vi.fn(() => false),
        getHookSystem: vi.fn(() => undefined),
      } as unknown as Config;

      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Run shell command',
        command: 'ls',
        rootCommand: 'ls',
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        disabledConfig,
        confirmationDetails,
      );

      expect(result).toBeUndefined();
    });

    it('should include serialized confirmation details in result', async () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'edit',
        title: 'Write to important.txt',
        fileName: 'important.txt',
        filePath: '/tmp/important.txt',
        fileDiff: '+important content',
        originalContent: null,
        newContent: 'important content',
        isModifying: false,
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        mockConfig,
        confirmationDetails,
      );

      expect(result).toBeDefined();
      expect(result?.notificationType).toBe(NotificationType.ToolPermission);
      expect(result?.details.type).toBe('edit');
      expect(result?.details.title).toBe('Write to important.txt');
      expect(result?.details.fileName).toBe('important.txt');
      // onConfirm should NOT be in the serialized details (not serializable)
      expect(
        typeof (result?.details as Record<string, unknown>).onConfirm,
      ).not.toBe('function');
    });
  });
});
