import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

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

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { triggerToolNotificationHook } from '../core/coreToolHookTriggers.js';
import { NotificationType } from './types.js';
import { Config } from '../config/config.js';
import { SessionHookOwner } from './session-hook-owner.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from './hook-configuration.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import type { HookExecutionOwner } from './hookEventHandler.js';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-tools';

describe('Notification Hook (ToolPermission)', () => {
  let execution: HookExecutionOwner;
  const owners: SessionHookOwner[] = [];
  beforeEach(() => {
    const config = new Config({
      sessionId: 'notification',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'test',
      debugMode: false,
      enableHooks: true,
    });
    const root = new SessionHookOwner(
      readHookDefinitions(config),
      hookSessionRuntime(
        config,
        new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        }),
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-caller-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      true,
      new MessageBus(),
    );
    owners.push(root);
    execution = root.execution({
      sessionId: () => 'notification',
      transcriptPath: () => undefined,
    });
  });
  afterEach(async () => {
    await Promise.all(owners.splice(0).map((root) => root.dispose()));
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
        confirmationDetails,
        execution,
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
        rootCommands: ['rm'],
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        confirmationDetails,
        execution,
      );

      expect(result).toBeDefined();
      expect(result?.notificationType).toBe(NotificationType.ToolPermission);
      expect(result?.message).toContain('Run shell command');
      expect(result?.details.type).toBe('exec');
      expect(result?.details.command).toBe('rm -rf /');
    });

    it('should return undefined when hooks are disabled', async () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Run shell command',
        command: 'ls',
        rootCommand: 'ls',
        rootCommands: ['ls'],
        onConfirm: async () => {},
      };

      const result = await triggerToolNotificationHook(
        confirmationDetails,
        undefined,
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
        confirmationDetails,
        execution,
      );

      expect(result).toBeDefined();
      expect(result?.notificationType).toBe(NotificationType.ToolPermission);
      expect(result?.details.type).toBe('edit');
      expect(result?.details.title).toBe('Write to important.txt');
      expect(result?.details.fileName).toBe('important.txt');
      // onConfirm should NOT be in the serialized details (not serializable)
      expect(result?.details).not.toHaveProperty('onConfirm');
    });
  });
});
