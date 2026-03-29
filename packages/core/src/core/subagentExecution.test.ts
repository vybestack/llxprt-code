/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  checkTerminationConditions,
  filterTextWithEmoji,
  checkGoalCompletion,
  processInteractiveTextResponse,
  handleExecutionError,
  createCompletionChannel,
} from './subagentExecution.js';
import { SubagentTerminateMode, type OutputObject } from './subagentTypes.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { AnsiToken } from '../utils/terminalSerializer.js';

function makeOutput(): OutputObject {
  return { emitted_vars: {}, terminate_reason: SubagentTerminateMode.ERROR };
}

describe('subagentExecution', () => {
  // --- checkTerminationConditions ---

  describe('checkTerminationConditions', () => {
    it('should return shouldStop=false when within limits', () => {
      const ctx = {
        runConfig: { max_turns: 10, max_time_minutes: 30 },
        subagentId: 'test',
        output: makeOutput(),
        logger: new DebugLogger('test'),
      };
      const result = checkTerminationConditions(0, Date.now(), ctx);
      expect(result.shouldStop).toBe(false);
    });

    it('should stop at max_turns', () => {
      const ctx = {
        runConfig: { max_turns: 5, max_time_minutes: 30 },
        subagentId: 'test',
        output: makeOutput(),
        logger: new DebugLogger('test'),
      };
      const result = checkTerminationConditions(5, Date.now(), ctx);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe(SubagentTerminateMode.MAX_TURNS);
      expect(ctx.output.terminate_reason).toBe(SubagentTerminateMode.MAX_TURNS);
    });

    it('should stop at timeout', () => {
      const ctx = {
        runConfig: { max_turns: 100, max_time_minutes: 0 },
        subagentId: 'test',
        output: makeOutput(),
        logger: new DebugLogger('test'),
      };
      // Start time in the past
      const result = checkTerminationConditions(0, Date.now() - 60000, ctx);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe(SubagentTerminateMode.TIMEOUT);
    });

    it('should handle undefined max_turns (no turn limit)', () => {
      const ctx = {
        runConfig: {
          max_turns: undefined as unknown as number,
          max_time_minutes: 30,
        },
        subagentId: 'test',
        output: makeOutput(),
        logger: new DebugLogger('test'),
      };
      const result = checkTerminationConditions(999, Date.now(), ctx);
      expect(result.shouldStop).toBe(false);
    });
  });

  // --- filterTextWithEmoji ---

  describe('filterTextWithEmoji', () => {
    it('should pass through when no emojiFilter', () => {
      const result = filterTextWithEmoji('hello world', {});
      expect(result.text).toBe('hello world');
      expect(result.blocked).toBe(false);
    });

    it('should apply emoji filter and return filtered text', () => {
      const mockFilter = {
        filterText: vi
          .fn()
          .mockReturnValue({ filtered: 'cleaned', blocked: false }),
      };
      const result = filterTextWithEmoji('hello ', {
        emojiFilter: mockFilter as never,
      });
      expect(result.text).toBe('cleaned');
      expect(result.blocked).toBe(false);
    });

    it('should return blocked=true when filter blocks', () => {
      const mockFilter = {
        filterText: vi
          .fn()
          .mockReturnValue({ blocked: true, error: 'Content blocked' }),
      };
      const result = filterTextWithEmoji('bad content', {
        emojiFilter: mockFilter as never,
      });
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('Content blocked');
    });

    it('should call onMessage with system feedback', () => {
      const onMessage = vi.fn();
      const mockFilter = {
        filterText: vi.fn().mockReturnValue({
          filtered: 'ok',
          blocked: false,
          systemFeedback: 'warning!',
        }),
      };
      filterTextWithEmoji('test', {
        emojiFilter: mockFilter as never,
        onMessage,
      });
      expect(onMessage).toHaveBeenCalledWith('warning!');
    });
  });

  // --- checkGoalCompletion ---

  describe('checkGoalCompletion', () => {
    it('should return todo reminder messages', async () => {
      const ctx = {
        output: makeOutput(),
        outputConfig: { outputs: { x: 'var x' } },
        subagentId: 'test',
        logger: new DebugLogger('test'),
      };
      const result = await checkGoalCompletion(ctx, 'Please finish todos', 0);
      expect(result).not.toBeNull();
      expect(result![0].parts[0]).toHaveProperty('text', 'Please finish todos');
    });

    it('should return null when no outputs expected (GOAL)', async () => {
      const ctx = {
        output: makeOutput(),
        outputConfig: undefined,
        subagentId: 'test',
        logger: new DebugLogger('test'),
      };
      const result = await checkGoalCompletion(ctx, null, 0);
      expect(result).toBeNull();
      expect(ctx.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    });

    it('should return null when all outputs emitted (GOAL)', async () => {
      const output = makeOutput();
      output.emitted_vars = { x: 'val' };
      const ctx = {
        output,
        outputConfig: { outputs: { x: 'var x' } },
        subagentId: 'test',
        logger: new DebugLogger('test'),
      };
      const result = await checkGoalCompletion(ctx, null, 1);
      expect(result).toBeNull();
      expect(ctx.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    });

    it('should return nudge messages for missing outputs', async () => {
      const ctx = {
        output: makeOutput(),
        outputConfig: { outputs: { x: 'var x', y: 'var y' } },
        subagentId: 'test',
        logger: new DebugLogger('test'),
      };
      const result = await checkGoalCompletion(ctx, null, 0);
      expect(result).not.toBeNull();
      const text = (result![0].parts[0] as { text: string }).text;
      expect(text).toContain('x');
      expect(text).toContain('y');
      expect(text).toContain('self_emitvalue');
    });
  });

  // --- processInteractiveTextResponse ---

  describe('processInteractiveTextResponse', () => {
    it('should set final_message from text', () => {
      const output = makeOutput();
      processInteractiveTextResponse('Hello world', { output });
      expect(output.final_message).toBe('Hello world');
    });

    it('should not set final_message for empty text', () => {
      const output = makeOutput();
      processInteractiveTextResponse('   ', { output });
      expect(output.final_message).toBeUndefined();
    });

    it('should throw when emoji filter blocks', () => {
      const output = makeOutput();
      const mockFilter = {
        filterText: vi
          .fn()
          .mockReturnValue({ blocked: true, error: 'Blocked!' }),
      };
      expect(() =>
        processInteractiveTextResponse('bad', {
          output,
          emojiFilter: mockFilter as never,
        }),
      ).toThrow('Blocked!');
      expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    });
  });

  // --- handleExecutionError ---

  describe('handleExecutionError', () => {
    it('should set ERROR terminate reason and final message', () => {
      const ctx = {
        output: makeOutput(),
        subagentId: 'test',
        logger: new DebugLogger('test'),
      };
      handleExecutionError(new Error('Something broke'), ctx);
      expect(ctx.output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
      expect(ctx.output.final_message).toBe('Something broke');
    });

    it('should not overwrite existing final_message', () => {
      const ctx = {
        output: { ...makeOutput(), final_message: 'Already set' },
        subagentId: 'test',
        logger: new DebugLogger('test'),
      };
      handleExecutionError(new Error('New error'), ctx);
      expect(ctx.output.final_message).toBe('Already set');
    });

    it('should handle non-Error values', () => {
      const ctx = {
        output: makeOutput(),
        subagentId: 'test',
        logger: new DebugLogger('test'),
      };
      handleExecutionError('string error', ctx);
      expect(ctx.output.final_message).toBe('string error');
    });
  });

  // --- createCompletionChannel ---

  describe('createCompletionChannel', () => {
    function makeToken(text: string): AnsiToken {
      return {
        text,
        bold: false,
        italic: false,
        underline: false,
        dim: false,
        inverse: false,
        fg: '',
        bg: '',
      };
    }

    it('should forward string output to onMessage', () => {
      const onMessage = vi.fn();
      const channel = createCompletionChannel({ onMessage });
      channel.outputUpdateHandler('call-1', 'hello world');
      expect(onMessage).toHaveBeenCalledWith('hello world');
    });

    it('should convert well-formed AnsiOutput to text', () => {
      const onMessage = vi.fn();
      const channel = createCompletionChannel({ onMessage });
      const ansiOutput = [
        [makeToken('line one')],
        [makeToken('line '), makeToken('two')],
      ];
      channel.outputUpdateHandler('call-1', ansiOutput);
      const result = onMessage.mock.calls[0][0] as string;
      expect(result).toContain('line one');
      expect(result).toContain('line two');
      expect(result.split(String.fromCharCode(10))).toHaveLength(2);
    });

    it('should skip undefined line entries in AnsiOutput without crashing', () => {
      const onMessage = vi.fn();
      const channel = createCompletionChannel({ onMessage });
      const ansiOutput = [
        [makeToken('valid')],
        undefined as never,
        null as never,
        [makeToken('also valid')],
      ];
      channel.outputUpdateHandler('call-1', ansiOutput);
      const result = onMessage.mock.calls[0][0] as string;
      expect(result).toBe('valid\nalso valid');
    });

    it('should not call onMessage when output is falsy', () => {
      const onMessage = vi.fn();
      const channel = createCompletionChannel({ onMessage });
      channel.outputUpdateHandler('call-1', undefined as never);
      expect(onMessage).not.toHaveBeenCalled();
    });

    it('should not throw when onMessage is not provided', () => {
      const channel = createCompletionChannel({});
      expect(() =>
        channel.outputUpdateHandler('call-1', 'some output'),
      ).not.toThrow();
    });
  });
});
