/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { AttemptRecorder } from './attemptRecorder.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  createStreamAccumulatorState,
  processStreamChunk,
  resolveTokenCounts,
} from './streamProcessor.js';

function retainedPayloadCharacters(
  root: unknown,
  seen = new Set<object>(),
): number {
  if (typeof root === 'string') return root.length >= 512 ? root.length : 0;
  if (typeof root !== 'object' || root === null || seen.has(root)) return 0;
  seen.add(root);
  const values: unknown[] =
    root instanceof Map ? [...root.values()] : Object.values(root);
  return values.reduce<number>(
    (sum, value) => sum + retainedPayloadCharacters(value, seen),
    0,
  );
}

function recorder(): AttemptRecorder {
  const result = new AttemptRecorder({
    providerName: 'test',
    defaultModelName: 'test',
    config: undefined,
    logicalRequestId: 'retention',
    wrapperOwned: true,
  });
  result.ensureAttemptStarted();
  return result;
}

function exercise(retainAll: boolean): { live: number; chunks: number } {
  const attempt = recorder();
  const state = createStreamAccumulatorState();
  const control: string[] = [];
  for (let index = 0; index < 64; index++) {
    const text = `${index}:` + 'x'.repeat(1024);
    if (retainAll) control.push(text);
    processStreamChunk(
      { speaker: 'ai', blocks: [{ type: 'text', text }] },
      state,
      performance.now(),
      attempt,
    );
  }
  return {
    live: retainedPayloadCharacters({ attempt, state, control }),
    chunks: state.chunkCount,
  };
}

describe('response diagnostics ownership', () => {
  it('keeps no response payload in the wrapper or active attempt', () => {
    const result = exercise(false);
    expect(result.chunks).toBe(64);
    expect(result.live).toBe(0);
  });

  it('rejects a control that retains all response pieces', () => {
    expect(exercise(true).live).toBeGreaterThan(64 * 1024);
  });

  it('uses provider usage instead of per-piece estimates once usage arrives', () => {
    const attempt = recorder();
    const state = createStreamAccumulatorState();
    processStreamChunk(
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a reply without usage' }],
      },
      state,
      performance.now(),
      attempt,
    );
    expect(state.estimatedOutputTokens).toBeGreaterThan(0);
    processStreamChunk(
      {
        speaker: 'ai',
        blocks: [],
        metadata: {
          usage: { promptTokens: 17, completionTokens: 9, totalTokens: 26 },
        },
      },
      state,
      performance.now(),
      attempt,
    );
    const tokens = resolveTokenCounts(
      state.latestTokenUsage,
      state.estimatedOutputTokens,
      new DebugLogger('test:retention'),
    );
    expect(tokens.input_token_count + tokens.output_token_count).toBe(26);
    expect(tokens.output_token_count).toBe(9);
  });

  it('does not retain payload after attempt completion', () => {
    const attempt = recorder();
    const id = attempt.getCurrentAttemptId();
    if (id === undefined) throw new Error('Missing active attempt');
    attempt.recordTokenBearingChunk(id, undefined, 'y'.repeat(4096));
    attempt.finalizeAttempt('success', 'test');
    expect(retainedPayloadCharacters(attempt)).toBe(0);
  });
});
