/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so hook state updates are flushed.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * D8 fail-fast instrumentation-error integration tests (AC-8) and dual-failure
 * AggregateError tests (AC-4), split from useSubmitQuery.lifecycle.test.tsx.
 *
 * Uses a real OperationLifecycleRegistry + a failing PerfSink (non-errno
 * internal append error) writing to temp files. Proves that internal
 * instrumentation errors propagate (fail-fast) rather than being silently
 * debug-logged, and that when BOTH the provider path and finalisation fail an
 * AggregateError preserves both errors in exact order. Mocks are limited to
 * external boundaries (runStream, prepareQueryForAgent, event handlers) — the
 * lifecycle, sink, and retention are real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery } from '../useSubmitQuery.js';
import {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type { PerfSinkFilesystem } from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import {
  OperationLifecycleRegistry,
  type OperationIdentityProvider,
} from '../operationLifecycle.js';
import { mkdtemp, rm, readdir, access, mkdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeferred } from './createDeferred.js';
import {
  createLifecycleDeps,
  buildLifecycleHookDeps,
  fixtureIdentity,
  type LifecycleDeps,
} from './lifecyclePerfFixtures.js';

const INTERNAL_ERROR_MESSAGE = 'internal append corruption';

// ─── Module mocks ───────────────────────────────────────────────────────────

// Controllable prepareQueryForAgent / displayUserMessage so individual tests
// can exercise error/cancellation paths without re-mocking the module.
let shouldProceedValue = true;
let queryToSendValue: string | null = 'test-query';
// When non-null, prepareQueryForAgent rejects with this error.
let prepareQueryReject: unknown | null = null;
// When non-null, prepareTurnForQuery rejects with this error.
let prepareTurnReject: unknown | null = null;
// When non-null, displayUserMessage throws this error.
let displayUserMessageThrowValue: unknown | null = null;

void vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
    displayUserMessage: vi.fn().mockImplementation((_q: string, _t: number) => {
      if (displayUserMessageThrowValue !== null) {
        throw displayUserMessageThrowValue;
      }
    }),
    prepareQueryForAgent: vi.fn().mockImplementation(() => {
      if (prepareQueryReject !== null) {
        return Promise.reject(prepareQueryReject);
      }
      return Promise.resolve({
        queryToSend: queryToSendValue,
        shouldProceed: shouldProceedValue,
      });
    }),
    handleLoopDetectedEvent: vi.fn(),
  }),
}));

void vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

void vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockImplementation(() => {
    if (prepareTurnReject !== null) {
      return Promise.reject(prepareTurnReject);
    }
    return Promise.resolve(undefined);
  }),
}));

void vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: vi.fn(),
  processSlashCommandResult: vi.fn(),
}));

// dispatchAgentEvent is called inside processAgentEvent; mock it so terminal
// events release the turn gate without requiring full event-handler wiring.
void vi.mock('../agentEventDispatcher.js', () => ({
  dispatchAgentEvent: vi.fn(() => ({ agentMessageBuffer: '' })),
}));

// ─── Failing-sink fixtures ──────────────────────────────────────────────────

/**
 * PerfSinkFilesystem whose appendFile throws a non-errno (internal) error.
 * PerfSink rethrows non-errno errors (fail-fast), so sink.write rejects.
 * ensureDir/openExclusive delegate to real fs so the claim file is created.
 */
class InternalErrorSinkFilesystem implements PerfSinkFilesystem {
  async ensureDir(d: string): Promise<void> {
    try {
      await access(d);
    } catch {
      await mkdir(d, { recursive: true, mode: 0o700 });
    }
  }
  async openExclusive(filePath: string, mode: number): Promise<void> {
    const handle = await open(filePath, 'wx', mode);
    await handle.close();
  }
  async appendFile(): Promise<void> {
    throw new Error(INTERNAL_ERROR_MESSAGE);
  }
}

interface FailingRegistry {
  registry: OperationLifecycleRegistry;
  sink: PerfSink;
  perfDir: string;
}

async function createFailingRegistry(): Promise<FailingRegistry> {
  const failDir = await mkdtemp(join(tmpdir(), 'perf-d8-'));
  const failUuid = crypto.randomUUID();
  let failSink: PerfSink | null = null;
  try {
    const failRetention = new PerfRetention({
      dir: failDir,
      runUuid: failUuid,
    });
    failSink = new PerfSink({
      dir: failDir,
      runUuid: failUuid,
      retention: failRetention,
      fs: new InternalErrorSinkFilesystem(),
    });
    await failSink.start();
    const provider: OperationIdentityProvider = {
      snapshot: () => fixtureIdentity(),
    };
    const failRegistry = new OperationLifecycleRegistry({
      identityProvider: provider,
      sink: failSink,
      retention: failRetention,
    });
    return { registry: failRegistry, sink: failSink, perfDir: failDir };
  } catch (err) {
    const cleanupErrors: unknown[] = [];
    if (failSink !== null) {
      try {
        await failSink.dispose();
      } catch (e) {
        cleanupErrors.push(e);
      }
    }
    try {
      await rm(failDir, { recursive: true, force: true });
    } catch (e) {
      cleanupErrors.push(e);
    }
    if (cleanupErrors.length === 1) {
      throw new AggregateError(
        [err, cleanupErrors[0]],
        'setup cleanup also failed',
      );
    }
    if (cleanupErrors.length > 1) {
      throw new AggregateError(
        [err, ...cleanupErrors],
        'setup cleanup also failed',
      );
    }
    throw err;
  }
}

// ─── Per-test failing-sink cleanup ──────────────────────────────────────────

/**
 * Tracks the failing sink created by each test so afterEach can independently
 * attempt disposal and directory removal. The sink's dispose is expected to
 * reject (retained internal instrumentation error); in the normal path the test
 * body asserts that rejection and sets bodyDisposed so afterEach skips
 * redundant disposal. If the body threw early, afterEach disposes — observing
 * the expected rejection locally so it does not become unhandled — and surfaces
 * only unexpected errors.
 */
interface FailCtx {
  sink: PerfSink;
  perfDir: string;
  bodyDisposed: boolean;
}

let failCtx: FailCtx | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderWithRegistry(
  deps: LifecycleDeps,
  registry: OperationLifecycleRegistry,
) {
  return renderHook(() =>
    useSubmitQuery(buildLifecycleHookDeps(deps, registry)),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — D8 fail-fast + dual-failure AggregateError (AC-4, AC-8)', () => {
  beforeEach(() => {
    shouldProceedValue = true;
    queryToSendValue = 'test-query';
    prepareQueryReject = null;
    prepareTurnReject = null;
    displayUserMessageThrowValue = null;
    failCtx = null;
  });

  afterEach(async () => {
    const ctx = failCtx;
    failCtx = null;
    if (ctx === null) return;
    const errors: unknown[] = [];
    if (!ctx.bodyDisposed) {
      // The test body did not reach its own disposal assertion. Dispose is
      // expected to reject with the internal error; observe it locally and
      // surface only unexpected errors.
      try {
        await ctx.sink.dispose();
        errors.push(new Error('failing sink dispose unexpectedly resolved'));
      } catch (err) {
        if (!(err instanceof Error) || err.message !== INTERNAL_ERROR_MESSAGE) {
          errors.push(err);
        }
      }
    }
    try {
      await rm(ctx.perfDir, { recursive: true, force: true });
    } catch (err) {
      errors.push(err);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'failing-sink cleanup failed');
    }
  });

  // -------------------------------------------------------------------------
  // D8: finalisation is awaited; internal instrumentation errors fail-fast
  // rather than being silently debug-logged (AC-8). Only genuinely external
  // filesystem errno errors fail-open inside PerfSink/retention.
  // -------------------------------------------------------------------------

  it('rejects (fail-fast) when sink throws a non-errno internal error on the completed path', async () => {
    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockResolvedValue(undefined),
      } as never,
    });

    const { result } = renderWithRegistry(deps, failRegistry);

    // submitQuery must reject — the instrumentation internal error is NOT
    // silently debug-logged and swallowed.
    await act(async () => {
      let caught: unknown = undefined;
      try {
        await result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-d8',
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(INTERNAL_ERROR_MESSAGE);
    });

    // No records on disk — the write failed (the file may exist from
    // openExclusive but contains no appended records). The drain and dispose
    // promises each carry the retained internal rejection; observe them with
    // local no-op handlers, then await/assert both.
    const drainPromise = failRegistry.drain();
    drainPromise.catch(() => {});
    const disposePromise = failSink.dispose();
    disposePromise.catch(() => {});
    await expect(drainPromise).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    await expect(disposePromise).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;

    const names = await readdir(failDir);
    let recordCount = 0;
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const fileResult = await readPerfRecords(join(failDir, name));
      recordCount += fileResult.records.filter(
        (r) => r.record_type === 'operation',
      ).length;
    }
    expect(recordCount).toBe(0);
  });

  it('handles the original provider error AND fails-fast when both stream and finalise fail', async () => {
    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    // handleSubmissionError is mocked at the module level; import it to verify
    // it was called with the ORIGINAL provider error.
    const streamUtils = await import('../streamUtils.js');
    const handleSubmissionErrorMock =
      streamUtils.handleSubmissionError as unknown as {
        mockClear: () => void;
        mock: { calls: unknown[][] };
      };
    handleSubmissionErrorMock.mockClear();

    const streamError = new Error('provider stream failed');

    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockRejectedValue(streamError),
      } as never,
    });

    const { result } = renderWithRegistry(deps, failRegistry);

    // submitQuery must reject with the INSTRUMENTATION error (fail-fast),
    // NOT the provider error — proving the instrumentation error is not
    // routed through or replaced by user-facing provider-error handling.
    await act(async () => {
      await expect(
        result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-d8-err',
        ),
      ).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    });

    // The ORIGINAL provider error was handled for the user
    // (handleSubmissionError called with streamError), proving the provider
    // error is not lost.
    expect(handleSubmissionErrorMock.mock.calls.length).toBeGreaterThanOrEqual(
      1,
    );
    const firstCallFirstArg = handleSubmissionErrorMock.mock.calls[0][0];
    expect(firstCallFirstArg).toBe(streamError);

    await expect(failSink.dispose()).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;
  });

  it('propagates the finalisation error (fail-fast) on the no-proceed path when sink fails', async () => {
    shouldProceedValue = false;
    queryToSendValue = null;

    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    const deps = createLifecycleDeps({
      runStreamRef: { current: vi.fn() } as never,
    });

    const { result } = renderWithRegistry(deps, failRegistry);

    await act(async () => {
      await expect(
        result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-noproceed-failfast',
        ),
      ).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    });

    await expect(failSink.dispose()).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;
  });

  // -------------------------------------------------------------------------
  // D8 gap: displayUserMessage throw + cancellation paths where finalisation
  // also rejects → AggregateError preserves dual failures (AC-4, AC-8).
  // -------------------------------------------------------------------------

  it('AggregateError [display error, finalisation error] when displayUserMessage throws and finalise also fails', async () => {
    displayUserMessageThrowValue = new Error('display failed');

    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    const deps = createLifecycleDeps({
      runStreamRef: { current: vi.fn() } as never,
    });

    const { result } = renderWithRegistry(deps, failRegistry);

    let caught: unknown = undefined;
    await act(async () => {
      try {
        await result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-display-aggr',
        );
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect((aggregate.errors[0] as Error).message).toBe('display failed');
    expect((aggregate.errors[1] as Error).message).toBe(INTERNAL_ERROR_MESSAGE);

    await expect(failSink.dispose()).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;
  });

  it('AggregateError [cancellation, finalisation] when query prep is cancelled and finalise also fails', async () => {
    const cancelError = new DOMException('Aborted', 'AbortError');
    prepareQueryReject = cancelError;

    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    const deps = createLifecycleDeps({
      runStreamRef: { current: vi.fn() } as never,
    });

    const { result } = renderWithRegistry(deps, failRegistry);

    let caught: unknown = undefined;
    await act(async () => {
      try {
        await result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-qprep-cancel-aggr',
        );
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]).toBe(cancelError);
    expect((aggregate.errors[1] as Error).message).toBe(INTERNAL_ERROR_MESSAGE);

    await expect(failSink.dispose()).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;
  });

  it('AggregateError [cancellation, finalisation] when turn prep is cancelled and finalise also fails', async () => {
    const cancelError = new DOMException('Aborted', 'AbortError');
    prepareTurnReject = cancelError;

    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    const deps = createLifecycleDeps({
      runStreamRef: { current: vi.fn() } as never,
    });

    const { result } = renderWithRegistry(deps, failRegistry);

    let caught: unknown = undefined;
    await act(async () => {
      try {
        await result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-tprep-cancel-aggr',
        );
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]).toBe(cancelError);
    expect((aggregate.errors[1] as Error).message).toBe(INTERNAL_ERROR_MESSAGE);

    await expect(failSink.dispose()).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;
  });

  it('AggregateError [cancellation, finalisation] when stream is cancelled and finalise also fails', async () => {
    const turnDeferred = createDeferred<void>();

    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    const deps = createLifecycleDeps({
      runStreamRef: {
        current: vi.fn().mockReturnValueOnce(turnDeferred.promise),
      } as never,
    });

    const { result } = renderWithRegistry(deps, failRegistry);

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery(
        'hello',
        undefined,
        'sess-1#agentic-loop#uuid-stream-cancel-aggr',
      );
    });

    await waitFor(() => expect(deps.abortControllerRef.current).not.toBeNull());

    deps.abortControllerRef.current!.abort();
    const cancelError = new DOMException('Aborted', 'AbortError');

    let caught: unknown = undefined;
    await act(async () => {
      turnDeferred.reject(cancelError);
      try {
        await turnPromise;
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]).toBe(cancelError);
    expect((aggregate.errors[1] as Error).message).toBe(INTERNAL_ERROR_MESSAGE);

    await expect(failSink.dispose()).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;
  });

  it('AggregateError [setup error, finalisation error] when post-begin setup and finalise both fail', async () => {
    const setupError = new Error('committed-segment setup failed');
    const {
      registry: failRegistry,
      sink: failSink,
      perfDir: failDir,
    } = await createFailingRegistry();
    failCtx = { sink: failSink, perfDir: failDir, bodyDisposed: false };

    const runStream = vi.fn();
    const deps = createLifecycleDeps({
      runStreamRef: { current: runStream } as never,
    });
    vi.spyOn(deps.pendingResponse, 'beginCommittedSegments').mockImplementation(
      () => {
        throw setupError;
      },
    );

    const { result } = renderWithRegistry(deps, failRegistry);
    let caught: unknown = undefined;
    await act(async () => {
      try {
        await result.current.submitQuery(
          'hello world',
          undefined,
          'sess-1#agentic-loop#uuid-setup-aggr',
        );
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]).toBe(setupError);
    expect((aggregate.errors[1] as Error).message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(deps.setIsRespondingCalls).toEqual([true, false]);
    expect(runStream).not.toHaveBeenCalled();

    await expect(failSink.dispose()).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    failCtx.bodyDisposed = true;
  });
});
