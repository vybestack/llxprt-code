/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for prepareQueryForAgent's proceed gate (issue #2136).
 *
 * The gate depends on THIS turn's own abort signal, not the shared
 * turnCancelledRef. A fresh turn must proceed; only a turn whose own signal was
 * aborted before preparation is skipped.
 */

import { describe, it, expect, vi } from 'vitest';
import { type MessageSenderType } from '@vybestack/llxprt-code-core';
import {
  prepareQueryForAgent,
  type PrepareQueryDeps,
} from '../queryPreparer.js';
import type { SlashCommandProcessorResult } from '../../../types.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

function createDeps(
  overrides: Partial<PrepareQueryDeps> = {},
): PrepareQueryDeps {
  return {
    runtime: createStreamRuntimeForTest({ getModel: () => 'test-model' }),
    logUserPrompt: vi.fn(),
    addItem: vi.fn(),
    onDebugMessage: vi.fn(),
    handleShellCommand: vi.fn(() => false),
    handleSlashCommand: vi.fn(
      async (): Promise<SlashCommandProcessorResult | false> => false,
    ),
    logger: {
      logMessage: async (_s: MessageSenderType, _t: string) => {},
    },
    shellModeActive: false,
    scheduleToolCalls: vi.fn(),
    getToolHandle: () => undefined,
    ...overrides,
  };
}

describe('prepareQueryForAgent proceed gate (issue #2136)', () => {
  // The gate's sole input is the turn's OWN abort signal. These two cases fully
  // specify it: not-aborted → proceed, aborted → skip. (turnCancelledRef is no
  // longer consulted here, so there is no "prior cancellation" state to model —
  // a stale shared flag can no longer drop a fresh turn.)
  it('proceeds for a fresh turn whose own signal is not aborted', async () => {
    const controller = new AbortController();
    const result = await prepareQueryForAgent(
      'hello',
      1000,
      controller.signal,
      'p1',
      createDeps(),
    );
    expect(result.shouldProceed).toBe(true);
    expect(result.queryToSend).toBe('hello');
  });

  it('skips a turn whose own abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await prepareQueryForAgent(
      'hello',
      1000,
      controller.signal,
      'p1',
      createDeps(),
    );
    expect(result.shouldProceed).toBe(false);
    expect(result.queryToSend).toBeNull();
  });
});
