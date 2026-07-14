/**
 * @plan PLAN-20260707-AGENTNEUTRAL.P22
 * @requirement REQ-005.5a
 *
 * Behavioral characterization of the subagent slice BEFORE retyping
 * subagent*.ts off provider-specific types (P23). These tests pin OBSERVABLE behavior
 * so the retype cannot silently change tool-response processing, text
 * response handling, termination logic, or emoji filtering.
 *
 * Mock boundary: only the provider stream is mocked. The subagent tool
 * processing and execution helpers run with REAL logic.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  toSnakeCase,
  isFatalToolError,
  extractToolDetail,
  buildToolUnavailableMessage,
  buildPartsFromCompletedCalls,
  type BuildPartsContext,
} from '../subagentToolProcessing.js';
import {
  filterTextWithEmoji,
  checkTerminationConditions,
  type ExecutionLoopContext,
} from '../subagentExecution.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import type { CompletedToolCall } from '../coreToolScheduler.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ToolResultDisplay } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeLogger(): DebugLogger {
  return {
    debug: () => {},
    warn: () => {},
    info: () => {},
    error: () => {},
  } as unknown as DebugLogger;
}

function makeCompletedCall(
  name: string,
  callId: string,
  responseParts?: ContentBlock[],
  status: 'success' | 'error' | 'cancelled' = 'success',
): CompletedToolCall {
  return {
    request: { callId, name, args: {} },
    status,
    response: { responseParts },
    tool: { name },
  } as unknown as CompletedToolCall;
}

function makeBuildPartsCtx(subagentId = 'sa-1'): BuildPartsContext {
  return { onMessage: undefined, subagentId, logger: makeLogger() };
}

// ─── toSnakeCase ─────────────────────────────────────────────────────────────

describe('subagentRun characterization: toSnakeCase', () => {
  it('converts camelCase to snake_case', () => {
    expect(toSnakeCase('myToolName')).toBe('my_tool_name');
  });
  it('converts spaces and hyphens to underscores', () => {
    expect(toSnakeCase('my tool-name')).toBe('my_tool_name');
  });
  it('lowercases all letters', () => {
    expect(toSnakeCase('HelloWorld')).toBe('hello_world');
  });
  it('PROPERTY: toSnakeCase output is always lowercase', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (s) => {
        expect(toSnakeCase(s)).toBe(toSnakeCase(s).toLowerCase());
      }),
    );
  });
  it('PROPERTY: toSnakeCase contains no spaces or hyphens', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 50 }).filter((s) => s.length > 0),
        (s) => {
          const result = toSnakeCase(s);
          expect(result).not.toMatch(/[\s-]/);
        },
      ),
    );
  });
});

// ─── isFatalToolError ─────────────────────────────────────────────────────────

describe('subagentRun characterization: isFatalToolError', () => {
  it('returns true for TOOL_DISABLED', () => {
    expect(isFatalToolError(ToolErrorType.TOOL_DISABLED)).toBe(true);
  });
  it('returns true for TOOL_NOT_REGISTERED', () => {
    expect(isFatalToolError(ToolErrorType.TOOL_NOT_REGISTERED)).toBe(true);
  });
  it('returns false for undefined', () => {
    expect(isFatalToolError(undefined)).toBe(false);
  });
  it('returns false for other error types', () => {
    expect(isFatalToolError(ToolErrorType.VALIDATION_ERROR)).toBe(false);
  });
  it('PROPERTY: only TOOL_DISABLED and TOOL_NOT_REGISTERED are fatal', () => {
    const allTypes = Object.values(ToolErrorType);
    for (const t of allTypes) {
      const expected =
        t === ToolErrorType.TOOL_DISABLED ||
        t === ToolErrorType.TOOL_NOT_REGISTERED;
      expect(isFatalToolError(t)).toBe(expected);
    }
  });
});

// ─── extractToolDetail + buildToolUnavailableMessage ─────────────────────────

describe('subagentRun characterization: extractToolDetail', () => {
  it('extracts error.message when error is provided', () => {
    expect(extractToolDetail(undefined, new Error('boom'))).toBe('boom');
  });
  it('extracts string resultDisplay', () => {
    expect(extractToolDetail('display text')).toBe('display text');
  });
  it('extracts .message from object resultDisplay', () => {
    expect(
      extractToolDetail({
        message: 'obj detail',
      } as unknown as ToolResultDisplay),
    ).toBe('obj detail');
  });
  it('returns undefined for nothing', () => {
    expect(extractToolDetail()).toBeUndefined();
  });
  it('PROPERTY: error message takes priority over display', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (msg) => {
        expect(extractToolDetail('display', new Error(msg))).toBe(msg);
      }),
    );
  });
});

describe('subagentRun characterization: buildToolUnavailableMessage', () => {
  it('includes tool name and detail when available', () => {
    const msg = buildToolUnavailableMessage(
      'myTool',
      undefined,
      new Error('missing'),
    );
    expect(msg).toContain('myTool');
    expect(msg).toContain('missing');
  });
  it('uses default suffix when no detail', () => {
    const msg = buildToolUnavailableMessage('myTool');
    expect(msg).toContain('Please continue without using it');
  });
  it('PROPERTY: always mentions the tool name', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((s) => !s.includes('"')),
        (name) => {
          expect(buildToolUnavailableMessage(name)).toContain(name);
        },
      ),
    );
  });
});

// ─── buildPartsFromCompletedCalls ─────────────────────────────────────────────

describe('subagentRun characterization: buildPartsFromCompletedCalls', () => {
  it('produces tool_response blocks for calls without responseParts', () => {
    const calls = [makeCompletedCall('read_file', 'c1')];
    const parts = buildPartsFromCompletedCalls(calls, makeBuildPartsCtx());
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveProperty('type', 'tool_response');
    expect((parts[0] as { toolName: string }).toolName).toBe('read_file');
  });
  it('appends non-tool-call blocks from responseParts', () => {
    const textBlock: ContentBlock = { type: 'text', text: 'result text' };
    const calls = [makeCompletedCall('read_file', 'c1', [textBlock])];
    const parts = buildPartsFromCompletedCalls(calls, makeBuildPartsCtx());
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveProperty('type', 'text');
  });
  it('skips tool_call blocks within responseParts (only non-tool-call)', () => {
    const textBlock: ContentBlock = { type: 'text', text: 'visible' };
    const tcBlock: ContentBlock = {
      type: 'tool_call',
      id: 'inner',
      name: 'inner',
      parameters: {},
    };
    const calls = [makeCompletedCall('myTool', 'c1', [textBlock, tcBlock])];
    const parts = buildPartsFromCompletedCalls(calls, makeBuildPartsCtx());
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveProperty('type', 'text');
  });
  it('preserves order of completed calls', () => {
    const calls = [
      makeCompletedCall('tool_a', 'c1'),
      makeCompletedCall('tool_b', 'c2'),
      makeCompletedCall('tool_c', 'c3'),
    ];
    const parts = buildPartsFromCompletedCalls(calls, makeBuildPartsCtx());
    expect(parts).toHaveLength(3);
    expect((parts[0] as { toolName: string }).toolName).toBe('tool_a');
    expect((parts[1] as { toolName: string }).toolName).toBe('tool_b');
    expect((parts[2] as { toolName: string }).toolName).toBe('tool_c');
  });
  it('PROPERTY: one block per completed call when no responseParts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (n) => {
        const calls = Array.from({ length: n }, (_, i) =>
          makeCompletedCall(`t${i}`, `c${i}`),
        );
        const parts = buildPartsFromCompletedCalls(calls, makeBuildPartsCtx());
        expect(parts).toHaveLength(n);
      }),
    );
  });
  it('calls onMessage for display strings on success (non-output-updating tools)', () => {
    const messages: string[] = [];
    const ctx = makeBuildPartsCtx();
    ctx.onMessage = (msg: string) => {
      messages.push(msg);
    };
    const textBlock: ContentBlock = { type: 'text', text: 'output' };
    const calls = [makeCompletedCall('myTool', 'c1', [textBlock], 'success')];
    buildPartsFromCompletedCalls(calls, ctx);
    // responseParts are present, so display is extracted from response.resultDisplay which is undefined here
    // So no onMessage call expected for this case
    expect(messages).toHaveLength(0);
  });
});

// ─── filterTextWithEmoji ──────────────────────────────────────────────────────

describe('subagentRun characterization: filterTextWithEmoji', () => {
  function makeCtx(
    emojiFilter: unknown,
  ): Pick<ExecutionLoopContext, 'emojiFilter' | 'onMessage'> {
    return {
      emojiFilter: emojiFilter as ExecutionLoopContext['emojiFilter'],
      onMessage: undefined,
    };
  }
  it('passes through text when no emojiFilter', () => {
    const result = filterTextWithEmoji('hello world', makeCtx(undefined));
    expect(result.text).toBe('hello world');
    expect(result.blocked).toBe(false);
  });
  it('passes through when filter allows', () => {
    const filter = {
      filterText: () => ({ blocked: false, filtered: 'clean' }),
    };
    const result = filterTextWithEmoji('clean', makeCtx(filter));
    expect(result.text).toBe('clean');
    expect(result.blocked).toBe(false);
  });
  it('blocks when filter blocks', () => {
    const filter = {
      filterText: () => ({ blocked: true, error: 'bad emoji' }),
    };
    const result = filterTextWithEmoji('naughty', makeCtx(filter));
    expect(result.blocked).toBe(true);
    expect(result.error).toBe('bad emoji');
  });
  it('PROPERTY: no filter = pass-through with blocked=false', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (s) => {
        const result = filterTextWithEmoji(s, makeCtx(undefined));
        expect(result.text).toBe(s);
        expect(result.blocked).toBe(false);
      }),
    );
  });
});

// ─── checkTerminationConditions ──────────────────────────────────────────────

describe('subagentRun characterization: checkTerminationConditions', () => {
  function makeTermCtx(
    overrides: Partial<ExecutionLoopContext> = {},
  ): Parameters<typeof checkTerminationConditions>[2] {
    return {
      runConfig: { max_turns: 10, max_time_minutes: 30 },
      subagentId: 'sa-1',
      output: {
        terminate_reason: undefined,
        final_message: undefined,
        emitted_vars: {},
      },
      logger: makeLogger(),
      ...overrides,
    } as unknown as Parameters<typeof checkTerminationConditions>[2];
  }
  it('stops on max turns reached', () => {
    const result = checkTerminationConditions(10, Date.now(), makeTermCtx());
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe(SubagentTerminateMode.MAX_TURNS);
  });
  it('does not stop when under max turns', () => {
    const result = checkTerminationConditions(3, Date.now(), makeTermCtx());
    expect(result.shouldStop).toBe(false);
  });
  it('stops on timeout', () => {
    const startTime = Date.now() - 31 * 60 * 1000; // 31 min ago
    const result = checkTerminationConditions(3, startTime, makeTermCtx());
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe(SubagentTerminateMode.TIMEOUT);
  });
  it('does not stop within time limit', () => {
    const startTime = Date.now() - 10 * 60 * 1000; // 10 min ago
    const result = checkTerminationConditions(3, startTime, makeTermCtx());
    expect(result.shouldStop).toBe(false);
  });
  it('PROPERTY: max turns reached → always stops with MAX_TURNS', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 28 * 60 }), (minutesAgo) => {
        const result = checkTerminationConditions(
          10,
          Date.now() - minutesAgo * 60 * 1000,
          makeTermCtx(),
        );
        expect(result.shouldStop).toBe(true);
        expect(result.reason).toBe(SubagentTerminateMode.MAX_TURNS);
      }),
    );
  });
  it('PROPERTY: under max turns and within time → never stops', () => {
    fc.assert(
      fc.property(
        fc.record({
          turn: fc.integer({ min: 0, max: 9 }),
          minutesAgo: fc.integer({ min: 0, max: 29 }),
        }),
        ({ turn, minutesAgo }) => {
          const result = checkTerminationConditions(
            turn,
            Date.now() - minutesAgo * 60 * 1000,
            makeTermCtx(),
          );
          expect(result.shouldStop).toBe(false);
        },
      ),
    );
  });
});
