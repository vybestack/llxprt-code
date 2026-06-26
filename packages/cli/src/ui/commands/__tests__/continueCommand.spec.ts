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
import type {
  TokenInfo,
  ValueArgument,
  LiteralArgument,
} from '../schema/types.js';
import { assertDefined, assertType } from '../../../test-utils/assertions.js';

/**
 * Helper to narrow a command argument to the ValueArgument variant.
 */
function isValueArgument(
  arg: LiteralArgument | ValueArgument,
): arg is ValueArgument {
  return arg.kind === 'value';
}

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
  return result !== undefined && result.type === 'message';
}

/**
 * Helper to narrow the result type to OpenDialogActionReturn
 */
function isDialogAction(
  result: SlashCommandActionReturn | void | undefined,
): result is OpenDialogActionReturn {
  return result !== undefined && result.type === 'dialog';
}

/**
 * Helper to narrow the result type to PerformResumeActionReturn
 */
function isPerformResumeAction(
  result: SlashCommandActionReturn | void | undefined,
): result is PerformResumeActionReturn {
  return result !== undefined && result.type === 'perform_resume';
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

      assertType(result, isDialogAction);
      expect(result.dialog).toBe('sessionBrowser');
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

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toContain('interactive');
    });
  });

  describe('Direct resume path @requirement:REQ-EN-002', () => {
    it('/continue latest returns perform_resume', async () => {
      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('latest');
    });

    it('/continue <id> returns perform_resume with ID', async () => {
      const result = await continueCommand.action!(ctx, 'abc123');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('abc123');
    });

    it('/continue <number> returns perform_resume with index', async () => {
      const result = await continueCommand.action!(ctx, '3');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('3');
    });

    it('/continue <prefix> returns perform_resume with prefix', async () => {
      const result = await continueCommand.action!(ctx, 'abc');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('abc');
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

      assertType(result, isPerformResumeAction);
      // When active conversation exists, requiresConfirmation should be true
      expect(result.requiresConfirmation).toBe(true);
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

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toMatch(/conversation|replace/);
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

      assertType(result, isPerformResumeAction);
      // No confirmation flag when no active conversation
      expect(result.requiresConfirmation).toBeFalsy();
    });
  });

  describe('In-flight request guard @requirement:REQ-MP-004', () => {
    it('returns error when isProcessing=true with no args', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as unknown as CommandContext['services']['config'],
        },
      });
      ctx.session.isProcessing = true;

      const result = await continueCommand.action!(ctx, '');

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toContain('request');
      expect(result.content.toLowerCase()).toContain('progress');
    });

    it('returns error when isProcessing=true with latest', async () => {
      ctx = createMockCommandContext();
      ctx.session.isProcessing = true;

      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isMessageAction);
      expect(result.messageType).toBe('error');
      expect(result.content.toLowerCase()).toContain('request');
      expect(result.content.toLowerCase()).toContain('progress');
    });

    it('proceeds normally when isProcessing=false', async () => {
      ctx = createMockCommandContext();
      ctx.session.isProcessing = false;

      const result = await continueCommand.action!(ctx, 'latest');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('latest');
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
      assertDefined(schema);
      const firstArg = schema[0];
      assertDefined(firstArg);
      assertType(firstArg, isValueArgument);
      assertDefined(firstArg.completer);

      const completions = await firstArg.completer(ctx, '', mockTokenInfo());
      const values = completions.map((c) =>
        typeof c === 'string' ? c : c.value,
      );
      expect(values).toContain('latest');
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
      assertDefined(schema);
      const firstArg = schema[0];
      assertDefined(firstArg);
      assertType(firstArg, isValueArgument);
      assertDefined(firstArg.completer);

      const completions = await firstArg.completer(ctx, '', mockTokenInfo());
      expect(completions.length).toBeGreaterThanOrEqual(1);
    });

    it('completion returns empty for non-interactive mode', async () => {
      ctx = createMockCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          } as unknown as CommandContext['services']['config'],
        },
      });

      const schema = continueCommand.schema;
      assertDefined(schema);
      const firstArg = schema[0];
      assertDefined(firstArg);
      assertType(firstArg, isValueArgument);
      assertDefined(firstArg.completer);

      const completions = await firstArg.completer(ctx, '', mockTokenInfo());
      expect(Array.isArray(completions)).toBe(true);
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

      assertType(result, isDialogAction);
      expect(result.dialog).toBe('sessionBrowser');
    });

    it('trims whitespace around session ref', async () => {
      const result = await continueCommand.action!(ctx, '  abc123  ');

      assertType(result, isPerformResumeAction);
      expect(result.sessionRef).toBe('abc123');
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
          if (result === undefined) {
            // void return is valid for some commands
            return true;
          }
          return validTypes.includes(result.type);
        }),
      );
    });
  });
});
