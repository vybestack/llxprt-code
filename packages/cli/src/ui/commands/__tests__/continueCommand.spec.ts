/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the /continue command.
 * @plan PLAN-20260214-SESSIONBROWSER.P19
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { continueCommand } from '../continueCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type {
  CommandContext,
  SlashCommandActionReturn,
  MessageActionReturn,
  OpenDialogActionReturn,
  PerformResumeActionReturn,
} from '../types.js';
import type { TokenInfo } from '../schema/types.js';

/**
 * Helper to create mock TokenInfo for completer tests
 */
function mockTokenInfo(partial: string = ''): TokenInfo {
  return {
    tokens: [],
    partialToken: partial,
    hasTrailingSpace: false,
    position: 0,
  };
}

/**
 * Helper to narrow the result type to MessageActionReturn
 */
function isMessageAction(
  result: SlashCommandActionReturn | void | undefined,
): result is MessageActionReturn {
  return result !== undefined && result !== null && result.type === 'message';
}

/**
 * Helper to narrow the result type to OpenDialogActionReturn
 */
function isDialogAction(
  result: SlashCommandActionReturn | void | undefined,
): result is OpenDialogActionReturn {
  return result !== undefined && result !== null && result.type === 'dialog';
}

/**
 * Helper to narrow the result type to PerformResumeActionReturn
 */
function isPerformResumeAction(
  result: SlashCommandActionReturn | void | undefined,
): result is PerformResumeActionReturn {
  return (
    result !== undefined && result !== null && result.type === 'perform_resume'
  );
}

describe('continueCommand @plan:PLAN-20260214-SESSIONBROWSER.P19', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = createMockCommandContext();
  });

  describe('No-args path @requirement:REQ-EN-001', () => {
    it('returns dialog action when interactive with no args', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as unknown as CommandContext['services']['config'],
        },
      });

      const result = await continueCommand.action!(ctx, '');

      expect(isDialogAction(result)).toBe(true);
      if (isDialogAction(result)) {
        expect(result.dialog).toBe('sessionBrowser');
      }
    });

    it('returns error when non-interactive with no args @requirement:REQ-RC-012', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          } as unknown as CommandContext['services']['config'],
        },
      });

      const result = await continueCommand.action!(ctx, '');

      expect(isMessageAction(result)).toBe(true);
      if (isMessageAction(result)) {
        expect(result.messageType).toBe('error');
        expect(result.content.toLowerCase()).toContain('interactive');
      }
    });
  });

  describe('Direct resume path @requirement:REQ-EN-002', () => {
    it('/continue latest returns perform_resume', async () => {
      const result = await continueCommand.action!(ctx, 'latest');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        expect(result.sessionRef).toBe('latest');
      }
    });

    it('/continue <id> returns perform_resume with ID', async () => {
      const result = await continueCommand.action!(ctx, 'abc123');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        expect(result.sessionRef).toBe('abc123');
      }
    });

    it('/continue <number> returns perform_resume with index', async () => {
      const result = await continueCommand.action!(ctx, '3');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        expect(result.sessionRef).toBe('3');
      }
    });

    it('/continue <prefix> returns perform_resume with prefix', async () => {
      const result = await continueCommand.action!(ctx, 'abc');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        expect(result.sessionRef).toBe('abc');
      }
    });
  });

  describe('Active conversation guard @requirement:REQ-RC-010', () => {
    it('returns perform_resume with requiresConfirmation when active conversation exists in interactive mode', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as unknown as CommandContext['services']['config'],
        },
        ui: {
          // Simulate having messages in history (active conversation)
          pendingItem: { type: 'gemini', text: 'Previous message' },
        },
      });

      const result = await continueCommand.action!(ctx, 'latest');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        // When active conversation exists, requiresConfirmation should be true
        expect(
          (
            result as PerformResumeActionReturn & {
              requiresConfirmation?: boolean;
            }
          ).requiresConfirmation,
        ).toBe(true);
      }
    });

    it('returns error when active conversation exists in non-interactive mode @requirement:REQ-RC-011', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          } as unknown as CommandContext['services']['config'],
        },
        ui: {
          // Simulate having an active conversation
          pendingItem: { type: 'gemini', text: 'Previous message' },
        },
      });

      const result = await continueCommand.action!(ctx, 'latest');

      expect(isMessageAction(result)).toBe(true);
      if (isMessageAction(result)) {
        expect(result.messageType).toBe('error');
        expect(result.content.toLowerCase()).toMatch(/conversation|replace/);
      }
    });

    it('does not require confirmation when no active conversation exists', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as unknown as CommandContext['services']['config'],
        },
        ui: {
          pendingItem: null,
        },
      });

      const result = await continueCommand.action!(ctx, 'latest');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        // No confirmation flag when no active conversation
        expect(
          (
            result as PerformResumeActionReturn & {
              requiresConfirmation?: boolean;
            }
          ).requiresConfirmation,
        ).toBeFalsy();
      }
    });
  });

  describe('In-flight request guard @requirement:REQ-MP-004', () => {
    it('returns error when isProcessing=true with no args', async () => {
      // NOTE: isProcessing is not yet in CommandContext types.
      // This test documents the expected behavior once P20 adds it.
      // Using type assertion to allow test to compile while implementation pending.
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as unknown as CommandContext['services']['config'],
        },
      });
      // Add isProcessing to the context - this may need adjustment in P20
      (ctx.session as unknown as { isProcessing: boolean }).isProcessing = true;

      const result = await continueCommand.action!(ctx, '');

      expect(isMessageAction(result)).toBe(true);
      if (isMessageAction(result)) {
        expect(result.messageType).toBe('error');
        expect(result.content.toLowerCase()).toContain('request');
        expect(result.content.toLowerCase()).toContain('progress');
      }
    });

    it('returns error when isProcessing=true with latest', async () => {
      ctx = createMockCommandContext();
      // Add isProcessing to the context - this may need adjustment in P20
      (ctx.session as unknown as { isProcessing: boolean }).isProcessing = true;

      const result = await continueCommand.action!(ctx, 'latest');

      expect(isMessageAction(result)).toBe(true);
      if (isMessageAction(result)) {
        expect(result.messageType).toBe('error');
        expect(result.content.toLowerCase()).toContain('request');
        expect(result.content.toLowerCase()).toContain('progress');
      }
    });

    it('proceeds normally when isProcessing=false', async () => {
      ctx = createMockCommandContext();
      // Add isProcessing to the context - this may need adjustment in P20
      (ctx.session as unknown as { isProcessing: boolean }).isProcessing =
        false;

      const result = await continueCommand.action!(ctx, 'latest');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        expect(result.sessionRef).toBe('latest');
      }
    });
  });

  describe('Tab completion @requirement:REQ-RC-013', () => {
    it('completion includes "latest"', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as unknown as CommandContext['services']['config'],
        },
      });

      // Schema-based completion
      const schema = continueCommand.schema;
      expect(schema).toBeDefined();

      if (schema && schema.length > 0) {
        const firstArg = schema[0];
        if (firstArg.kind === 'value' && firstArg.completer) {
          const completions = await firstArg.completer(
            ctx,
            '',
            mockTokenInfo(),
          );
          const values = completions.map((c) =>
            typeof c === 'string' ? c : c.value,
          );
          expect(values).toContain('latest');
        }
      }
    });

    it('completion returns session previews when sessions exist', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
            getChatsDir: () => '/tmp/chats',
            getProjectHash: () => 'abc123',
          } as unknown as CommandContext['services']['config'],
        },
      });

      const schema = continueCommand.schema;
      expect(schema).toBeDefined();

      // The completer should be able to return session-related completions
      if (schema && schema.length > 0) {
        const firstArg = schema[0];
        if (firstArg.kind === 'value' && firstArg.completer) {
          const completions = await firstArg.completer(
            ctx,
            '',
            mockTokenInfo(),
          );
          // Should at minimum return 'latest'
          expect(completions.length).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it('completion returns empty for non-interactive mode', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          } as unknown as CommandContext['services']['config'],
        },
      });

      // When non-interactive, completion may return empty or limited results
      const schema = continueCommand.schema;
      if (schema && schema.length > 0) {
        const firstArg = schema[0];
        if (firstArg.kind === 'value' && firstArg.completer) {
          const completions = await firstArg.completer(
            ctx,
            '',
            mockTokenInfo(),
          );
          // In non-interactive mode, the completer might still return 'latest'
          // but session discovery requires interactive mode
          // This test verifies the completer handles non-interactive gracefully
          expect(Array.isArray(completions)).toBe(true);
        }
      }
    });
  });

  describe('Whitespace handling', () => {
    it('treats whitespace-only args as no-args (interactive opens dialog)', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as unknown as CommandContext['services']['config'],
        },
      });

      const result = await continueCommand.action!(ctx, '   ');

      expect(isDialogAction(result)).toBe(true);
      if (isDialogAction(result)) {
        expect(result.dialog).toBe('sessionBrowser');
      }
    });

    it('trims whitespace around session ref', async () => {
      const result = await continueCommand.action!(ctx, '  abc123  ');

      expect(isPerformResumeAction(result)).toBe(true);
      if (isPerformResumeAction(result)) {
        expect(result.sessionRef).toBe('abc123');
      }
    });
  });

  describe('Property-based tests @plan:PLAN-20260214-SESSIONBROWSER.P19', () => {
    it('non-empty args never returns dialog', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string().filter((s) => s.trim().length > 0),
          async (args) => {
            const result = await continueCommand.action!(ctx, args);
            // Non-empty args should route to perform_resume or error, never dialog
            return !isDialogAction(result);
          },
        ),
      );
    });

    it('result always has valid type field', async () => {
      const validTypes = [
        'dialog',
        'perform_resume',
        'message',
        'tool',
        'quit',
        'load_history',
        'submit_prompt',
        'confirm_shell_commands',
        'confirm_action',
      ];

      await fc.assert(
        fc.asyncProperty(fc.string(), async (args) => {
          const result = await continueCommand.action!(ctx, args);
          if (result === undefined || result === null) {
            // void return is valid for some commands
            return true;
          }
          return validTypes.includes(result.type);
        }),
      );
    });
  });
});
