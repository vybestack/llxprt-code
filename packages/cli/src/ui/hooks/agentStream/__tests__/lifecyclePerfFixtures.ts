/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared behavioral fixtures for useSubmitQuery operation-lifecycle integration
 * tests. Provides a real PerfSink / PerfRetention / OperationLifecycleRegistry
 * writing to temp files, and reads records back through the real tolerant
 * reader. Each call to {@link createLifecyclePerfHarness} returns an isolated
 * context so multiple test files can import this module without sharing state.
 */

import { vi } from 'bun:test';
import type React from 'react';
import type { UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  type AgentClientContract,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import {
  OperationLifecycleRegistry,
  type OperationIdentitySnapshot,
  type OperationIdentityProvider,
} from '../operationLifecycle.js';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function fixtureIdentity(): OperationIdentitySnapshot {
  return {
    session_id: 'test-session',
    runtime_id: 'runtime-uuid',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'proj-hash',
    llxprt_version: '0.0.0-test',
    git_sha: 'deadbeef',
    runtime: 'bun',
    platform: 'darwin',
    provider: 'test-provider',
    model: 'test-model',
    terminal_cols: 80,
    terminal_rows: 24,
    render_mode: 'ink',
  };
}

export function createMockAgentClient(): AgentClientContract {
  return {
    getCurrentSequenceModel: () => 'test-model',
    getChat: () =>
      ({
        recordCompletedToolCalls: vi.fn(),
      }) as never,
  } as unknown as AgentClientContract;
}

export interface LifecycleDeps {
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  runStreamRef: React.MutableRefObject<
    | ((
        message: unknown,
        signal: AbortSignal,
        promptId: string,
      ) => Promise<void>)
    | null
  >;
  setIsRespondingCalls: boolean[];
}

export function createLifecycleDeps(
  options?: Partial<LifecycleDeps>,
): LifecycleDeps {
  const setIsRespondingCalls: boolean[] = [];
  return {
    abortControllerRef:
      options?.abortControllerRef ??
      ({ current: null as AbortController | null } as never),
    runStreamRef: options?.runStreamRef ?? ({ current: null } as never),
    setIsRespondingCalls,
  };
}

export function buildLifecycleHookDeps(
  deps: LifecycleDeps,
  registry: OperationLifecycleRegistry,
): UseSubmitQueryDeps {
  return {
    runtime: createStreamRuntimeForTest(),
    agent: createMockAgentClient() as unknown as Agent,
    addItem: vi.fn().mockReturnValue(1),
    settings: {} as never,
    onDebugMessage: vi.fn(),
    onCancelSubmit: vi.fn(),
    setTurnCancelled: vi.fn(),
    onAuthError: vi.fn(),
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingResponse: new PendingResponseBuffer(undefined),
    pendingHistoryItemRef: {
      current: null,
    } as React.MutableRefObject<HistoryItemWithoutId | null>,
    thinkingBlocksRef: { current: [] },
    turnCancelledRef: { current: false },
    queuedSubmissionsRef: { current: [] },
    drainSuppressedRef: { current: false },
    enqueueSubmission: vi.fn(),
    enqueueSubmissionFirst: vi.fn(),
    requeueSubmission: vi.fn(),
    dequeueSubmission: vi.fn(),
    clearSubmissions: vi.fn(),
    tryReserveDrain: vi.fn().mockReturnValue(true),
    releaseDrain: vi.fn(),
    setPendingHistoryItem: vi.fn(),
    setIsResponding: vi.fn((value: unknown) => {
      if (typeof value === 'boolean') deps.setIsRespondingCalls.push(value);
    }) as never,
    setInitError: vi.fn(),
    setThought: vi.fn(),
    setLastAgentActivityTime: vi.fn(),
    scheduleToolCalls: vi.fn(),
    abortActiveStream: vi.fn(),
    handleShellCommand: vi.fn().mockReturnValue(false),
    handleSlashCommand: vi.fn().mockResolvedValue(false),
    logger: null,
    shellModeActive: false,
    loopDetectedRef: { current: false },
    lastProfileNameRef: { current: undefined },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    abortControllerRef: deps.abortControllerRef,
    runStreamRef: deps.runStreamRef,
    submitQueryRef: { current: null },
    isResponding: false,
    streamingState: StreamingState.Idle,
    recordingIntegration: {
      flushAtTurnBoundary: vi.fn(),
    } as unknown as RecordingIntegration,
    operationLifecycle: registry,
  };
}

export interface LifecyclePerfHarness {
  readonly registry: OperationLifecycleRegistry;
  setup: () => Promise<void>;
  drainAndRead: () => Promise<PerfOperationRecord[]>;
  cleanup: () => Promise<void>;
}

interface LifecyclePerfHarnessState {
  perfDir: string;
  sink: PerfSink | null;
  retention: PerfRetention | null;
  registry: OperationLifecycleRegistry | null;
  sinkDisposed: boolean;
}

async function disposeHarnessSink(
  state: LifecyclePerfHarnessState,
  errors: unknown[],
): Promise<void> {
  if (state.sink === null || state.sinkDisposed) return;
  try {
    await state.sink.dispose();
    state.sinkDisposed = true;
  } catch (error) {
    errors.push(error);
  }
}

async function removeHarnessDirectory(
  state: LifecyclePerfHarnessState,
  errors: unknown[],
): Promise<void> {
  if (state.perfDir === '') return;
  try {
    await rm(state.perfDir, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
}

async function setupHarness(state: LifecyclePerfHarnessState): Promise<void> {
  state.perfDir = await mkdtemp(join(tmpdir(), 'perf-lifecycle-'));
  try {
    const runUuid = crypto.randomUUID();
    state.retention = new PerfRetention({ dir: state.perfDir, runUuid });
    state.sink = new PerfSink({
      dir: state.perfDir,
      runUuid,
      retention: state.retention,
    });
    await state.sink.start();
    const provider: OperationIdentityProvider = {
      snapshot: () => fixtureIdentity(),
    };
    state.registry = new OperationLifecycleRegistry({
      identityProvider: provider,
      sink: state.sink,
      retention: state.retention,
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    await disposeHarnessSink(state, cleanupErrors);
    await removeHarnessDirectory(state, cleanupErrors);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'setup partial-failure cleanup also failed',
      );
    }
    throw error;
  }
}

async function readHarnessRecords(
  state: LifecyclePerfHarnessState,
): Promise<PerfOperationRecord[]> {
  const records: PerfOperationRecord[] = [];
  for (const name of await readdir(state.perfDir)) {
    if (!name.endsWith('.jsonl')) continue;
    const result = await readPerfRecords(join(state.perfDir, name));
    for (const record of result.records) {
      if (record.record_type === 'operation') {
        records.push(record);
      }
    }
  }
  return records;
}

async function drainAndReadHarness(
  state: LifecyclePerfHarnessState,
): Promise<PerfOperationRecord[]> {
  if (state.registry === null || state.sink === null) {
    throw new Error('LifecyclePerfHarness.setup() must be called first');
  }
  await state.registry.drain();
  await state.sink.dispose();
  state.sinkDisposed = true;
  return readHarnessRecords(state);
}

async function cleanupHarness(state: LifecyclePerfHarnessState): Promise<void> {
  const errors: unknown[] = [];
  await disposeHarnessSink(state, errors);
  await removeHarnessDirectory(state, errors);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'lifecycle perf harness cleanup failed');
  }
}

export function createLifecyclePerfHarness(): LifecyclePerfHarness {
  const state: LifecyclePerfHarnessState = {
    perfDir: '',
    sink: null,
    retention: null,
    registry: null,
    sinkDisposed: false,
  };
  return {
    get registry(): OperationLifecycleRegistry {
      if (state.registry === null) {
        throw new Error('LifecyclePerfHarness.setup() must be called first');
      }
      return state.registry;
    },
    setup: () => setupHarness(state),
    drainAndRead: () => drainAndReadHarness(state),
    cleanup: () => cleanupHarness(state),
  };
}
