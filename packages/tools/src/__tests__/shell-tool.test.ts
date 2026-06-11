/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell Tool Group Behavioral Tests
 *
 * Verifies observable behavior of ShellTool through injected
 * IShellExecutionService and IToolMessageBus. Primary assertions
 * are on ToolResult.lmContent (stdout/stderr content) and
 * ToolResult.returnDisplay — NOT on adapter method call counts.
 *
 * STATUS: RED — Tests compile but will fail at runtime until P11
 * moves real tool code and adapters are wired up.
 */

import { describe, it, expect } from 'vitest';
import { ShellTool } from '../index.js';
import type {
  IShellExecutionService,
  ShellResult,
  IToolMessageBus,
  ToolConfirmationOutcome,
} from '../interfaces/index.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

/**
 * Fake IShellExecutionService that returns controlled stdout/stderr/exitCode.
 * Infrastructure fake — not mock theater. Primary assertions verify
 * observable ToolResult content, not that execute() was called.
 */
function createFakeShellService(
  responses: Map<string, ShellResult>,
): IShellExecutionService {
  return {
    execute: async (command: string, _opts?: unknown) => {
      const response = responses.get(command);
      if (response) return response;
      return {
        stdout: '',
        stderr: `command not found: ${command}`,
        exitCode: 127,
        aborted: false,
      };
    },
    isCommandAllowed: (command: string) => {
      // Allow echo commands, deny everything else
      return command.trim().startsWith('echo ') || command.trim() === 'false';
    },
  };
}

/**
 * Fake IToolMessageBus that returns controlled confirmation outcomes.
 */
function createFakeMessageBus(
  outcome: ToolConfirmationOutcome,
): IToolMessageBus {
  return {
    requestConfirmation: async () => outcome,
    publishPolicyUpdate: async () => {},
  };
}

describe('Shell Tool Group Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  describe('ShellTool execution through IShellExecutionService adapter', () => {
    it('returns ToolResult with exit code and output for allowed command', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('echo hello', {
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
        aborted: false,
      });

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(responses),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'echo hello' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('hello');
      expect(result.llmContent).toContain('0');
      expect(result.returnDisplay).toContain('hello');
    });

    it('returns ToolResult with error content for failed command', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('false', {
        stdout: '',
        stderr: 'Command failed with exit code 1',
        exitCode: 1,
        aborted: false,
      });

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(responses),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'false' },
      );

      expect(result.error?.message).toContain('Command failed');
      expect(result.llmContent).toContain('exit code 1');
    });
  });

  describe('ShellTool denial: command not allowed by policy', () => {
    it('returns error ToolResult for denied command', async () => {
      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(new Map<string, ShellResult>()),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'rm -rf /' },
      );

      expect(result.error?.message).toContain('denied');
      expect(result.llmContent).toContain('rm -rf /');
    });

    it('denial produces observable result indicating blocked execution', async () => {
      const responses = new Map<string, ShellResult>();
      const shell = createFakeShellService(responses);

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(shell, createFakeMessageBus('proceed_once')),
        { command: 'rm -rf /' },
      );

      expect(result.error?.message).toContain('denied');
      expect(result.llmContent).toContain('blocked');
    });
  });

  describe('ShellTool approval/confirmation flow through IToolMessageBus', () => {
    it('requestConfirmation returns proceed_once and produces observable ToolResult', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('echo test', {
        stdout: 'test\n',
        stderr: '',
        exitCode: 0,
        aborted: false,
      });

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(responses),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'echo test' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('test');
    });

    it('requestConfirmation returns cancel and cancels execution with observable outcome', async () => {
      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(new Map<string, ShellResult>()),
          createFakeMessageBus('cancel'),
        ),
        { command: 'echo cancelled' },
      );

      expect(result.error?.message).toContain('cancel');
      expect(result.llmContent).toContain('cancel');
    });
  });

  describe('IShellExecutionService adapter round-trip', () => {
    it('save and retrieve command results through adapter', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('echo test', {
        stdout: 'test\n',
        stderr: '',
        exitCode: 0,
        aborted: false,
      });

      const tool = new ShellTool(
        createFakeShellService(responses),
        createFakeMessageBus('proceed_once'),
      );

      const result1 = await executeToolForBehavioralAssertion(tool, {
        command: 'echo test',
      });
      const result2 = await executeToolForBehavioralAssertion(tool, {
        command: 'echo test',
      });

      expect(result1.error).toBeUndefined();
      expect(result2.error).toBeUndefined();
      expect(result1.llmContent).toBe(result2.llmContent);
      expect(result1.llmContent).toContain('test');
    });
  });
});
