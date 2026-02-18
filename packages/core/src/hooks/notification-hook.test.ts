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

import { describe, it, expect } from 'vitest';
import { triggerToolNotificationHook } from '../core/coreToolHookTriggers.js';
import { NotificationType } from './types.js';
import type { Config } from '../config/config.js';
import type { HookDefinition, HookType } from './types.js';
import { HookSystem } from './hookSystem.js';
import type { ToolCallConfirmationDetails } from '../tools/tools.js';

function createTestConfigWithNotificationHook(command: string): Config {
  const hookDef: HookDefinition = {
    hooks: [
      {
        type: 'command' as HookType.Command,
        command,
        timeout: 5000,
      },
    ],
  };

  const hooks: Record<string, HookDefinition[]> = {
    Notification: [hookDef],
  };

  let hookSystem: HookSystem | undefined;

  const config = {
    getEnableHooks: () => true,
    getHooks: () => hooks,
    getSessionId: () => 'test-session-' + Date.now(),
    getWorkingDir: () => '/tmp/test',
    getTargetDir: () => '/tmp/test',
    getExtensions: () => [],
    getModel: () => 'test-model',
    getHookSystem: () => {
      if (!hookSystem) {
        hookSystem = new HookSystem(config as Config);
      }
      return hookSystem;
    },
  } as unknown as Config;

  return config;
}

describe('Notification Hook (ToolPermission)', () => {
  describe('triggerToolNotificationHook', () => {
    it('should fire Notification hook with ToolPermission type for edit confirmation', async () => {
      const config = createTestConfigWithNotificationHook(
        'echo \'{"received": true}\'',
      );

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
        config,
        confirmationDetails,
      );

      expect(result).toBeDefined();
      expect(result?.notificationType).toBe(NotificationType.ToolPermission);
    });

    it('should fire Notification hook with ToolPermission type for exec confirmation', async () => {
      const config = createTestConfigWithNotificationHook(
        'echo \'{"received": true}\'',
      );

      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Run shell command',
        command: 'rm -rf /',
        rootCommand: 'rm',
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        config,
        confirmationDetails,
      );

      expect(result).toBeDefined();
      expect(result?.notificationType).toBe(NotificationType.ToolPermission);
    });

    it('should return undefined when hooks are disabled', async () => {
      const config = {
        getEnableHooks: () => false,
        getHooks: () => ({}),
        getSessionId: () => 'test-session-disabled',
        getWorkingDir: () => '/tmp/test',
        getTargetDir: () => '/tmp/test',
        getExtensions: () => [],
        getModel: () => 'test-model',
        getHookSystem: () => undefined,
      } as unknown as Config;

      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Run shell command',
        command: 'ls',
        rootCommand: 'ls',
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        config,
        confirmationDetails,
      );

      expect(result).toBeUndefined();
    });

    it('should include serialized confirmation details in hook input', async () => {
      let capturedInput: string | undefined;
      const config = createTestConfigWithNotificationHook(
        'cat > /tmp/notification-test-input.json',
      );

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

      await triggerToolNotificationHook(config, confirmationDetails);

      const fs = await import('fs/promises');
      try {
        capturedInput = await fs.readFile(
          '/tmp/notification-test-input.json',
          'utf-8',
        );
        const parsed = JSON.parse(capturedInput);
        expect(parsed.notification_type).toBe('ToolPermission');
        expect(parsed.details).toBeDefined();
        expect(parsed.details.type).toBe('edit');
        expect(parsed.details.title).toBe('Write to important.txt');
        expect(parsed.details.fileName).toBe('important.txt');
      } finally {
        await fs.unlink('/tmp/notification-test-input.json').catch(() => {});
      }
    });
  });
});
