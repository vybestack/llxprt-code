/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P12 behavioral tests for InteractivePerfRuntime.start startup transaction
 * rollback (Item 2). Proves deterministic rollback on sink.start failure and
 * observer-install conflict, with no leaked artifacts/observers/timers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createInteractivePerfRuntime,
  type InteractivePerfRuntimeOptions,
} from './interactivePerfRuntime.js';
import type { OperationIdentitySnapshot } from '../agentStream/operationLifecycle.js';
import {
  setInteractiveStdoutObserver,
  setInteractiveRenderObserver,
  getInteractiveStdoutObserver,
  getInteractiveRenderObserver,
} from '../../inkRenderOptions.js';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import type {
  PerfRetentionFilesystem,
  PerfScheduler,
  PerfTimerHandle,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';

let dir: string;

function fixtureIdentity(): OperationIdentitySnapshot {
  return {
    session_id: 'sess-startup',
    runtime_id: 'rt-startup',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'hash-startup',
    llxprt_version: '0.11.0',
    git_sha: 'abc1234',
    runtime: 'bun-1.3.14',
    platform: 'darwin-arm64',
    provider: 'test-provider',
    model: 'test-model',
    terminal_cols: 80,
    terminal_rows: 24,
    render_mode: 'incremental',
  };
}

function makeOptions(
  overrides: Partial<InteractivePerfRuntimeOptions> = {},
): InteractivePerfRuntimeOptions & { perfDir: string } {
  return {
    enabled: true,
    memoryEnabled: false,
    perfDir: dir,
    identityProvider: { snapshot: () => fixtureIdentity() },
    ...overrides,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) {
    return error.errors.map(errorMessage);
  }
  return [errorMessage(error)];
}

describe('interactive perf runtime startup test lifecycle', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), 'perf-startup-'));
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);
  });

  afterEach(async () => {
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /**
   * Filesystem port whose ensureDir throws a non-errno (internal) error so
   * retention.start() fails fast (rethrows non-errno) rather than fail-opening.
   * The claim is never created (ensureDir fails before openExclusive), and the
   * timer is never started, proving no leaked artifact/observer/timer.
   */
  class InternalErrorRetentionFs implements PerfRetentionFilesystem {
    async ensureDir(): Promise<void> {
      throw new Error('internal retention start corruption');
    }
    async openExclusive(): Promise<void> {
      throw new Error('should not reach openExclusive');
    }
    async utimes(): Promise<void> {
      throw new Error('should not reach utimes');
    }
    async readdir(): Promise<string[]> {
      throw new Error('should not reach readdir');
    }
    async stat(): Promise<{ size: number; mtimeMs: number }> {
      throw new Error('should not reach stat');
    }
    async unlink(): Promise<void> {
      throw new Error('should not reach unlink');
    }
  }

  describe('InteractivePerfRuntime.start — startup rollback (Item 2)', () => {
    it('rolls back and rejects on sink.start failure (non-errno internal error)', async () => {
      const runtime = createInteractivePerfRuntime(
        makeOptions({
          __retentionFsForTesting: new InternalErrorRetentionFs(),
        }),
      );
      expect(runtime).not.toBe(null);

      let startError: unknown = null;
      try {
        await runtime!.start();
      } catch (err) {
        startError = err;
      }
      expect(startError).not.toBe(null);
      // The original startup error is surfaced. When rollback also encounters
      // cleanup errors, an AggregateError is used; when only the startup error
      // occurred, the plain Error is surfaced directly. Either way the original
      // message is present.
      const messages = errorMessages(startError);
      expect(messages.some((m) => m.includes('internal retention start'))).toBe(
        true,
      );

      // No observers installed.
      expect(getInteractiveStdoutObserver()).toBe(null);
      expect(getInteractiveRenderObserver()).toBe(null);
      expect(getPerfPhaseObserver()).toBe(null);

      // No claim file or perf jsonl leaked.
      const files = fs.readdirSync(dir);
      expect(files.some((f) => f.endsWith('.claim'))).toBe(false);
      expect(files.some((f) => f.endsWith('.jsonl'))).toBe(false);

      await expect(runtime!.dispose()).resolves.toBeUndefined();
      await expect(runtime!.dispose()).resolves.toBeUndefined();
    });

    it('rolls back and rejects on observer-install conflict (owner B)', async () => {
      // Start owner A first (installs observers owned by A's registry).
      const ownerA = createInteractivePerfRuntime(makeOptions());
      await ownerA!.start();
      expect(getInteractiveStdoutObserver()).not.toBe(null);
      expect(getInteractiveRenderObserver()).not.toBe(null);
      expect(getPerfPhaseObserver()).not.toBe(null);

      const filesAfterA = fs.readdirSync(dir);
      expect(filesAfterA.some((f) => f.endsWith('.claim'))).toBe(true);

      // Owner B: same perfDir, a different runUuid so its claim won't conflict.
      // B starts its sink (creates its own claim + timer), then conflicts on
      // observer ownership because A's observers are still installed.
      const ownerB = createInteractivePerfRuntime(
        makeOptions({ runUuid: '00000000-0000-4000-8000-000000000000' }),
      );
      expect(ownerB).not.toBe(null);

      let bStartError: unknown = null;
      try {
        await ownerB!.start();
      } catch (err) {
        bStartError = err;
      }
      expect(bStartError).not.toBe(null);
      // The observer-conflict error is surfaced. When rollback also encounters
      // cleanup errors, an AggregateError is used; when only the startup error
      // occurred (B's claim cleanup is fail-open errno or succeeds), the plain
      // Error is surfaced directly. Either way the original message is present.
      const bMessages = errorMessages(bStartError);
      expect(bMessages.some((m) => m.includes('observer is already'))).toBe(
        true,
      );

      // B's claim must be removed (no leaked claim from B).
      const filesAfterB = fs.readdirSync(dir);
      const claimsAfterB = filesAfterB.filter((f) => f.endsWith('.claim'));
      expect(claimsAfterB).toHaveLength(1);
      // The surviving claim is A's, not B's.
      expect(
        claimsAfterB.some((f) =>
          f.includes('00000000-0000-4000-8000-000000000000'),
        ),
      ).toBe(false);

      // A's observers remain owned (not clobbered by B's failed install).
      expect(getInteractiveStdoutObserver()).toBe(ownerA!.registry);
      expect(getInteractiveRenderObserver()).toBe(ownerA!.registry);
      expect(getPerfPhaseObserver()).toBe(ownerA!.registry);

      // Clean up A.
      await ownerA!.dispose();
      expect(getInteractiveStdoutObserver()).toBe(null);
      expect(getInteractiveRenderObserver()).toBe(null);
      expect(getPerfPhaseObserver()).toBe(null);

      await expect(ownerB!.dispose()).resolves.toBeUndefined();
      await expect(ownerB!.dispose()).resolves.toBeUndefined();

      // No B claim leaked.
      const finalFiles = fs.readdirSync(dir);
      expect(
        finalFiles.some((f) =>
          f.includes('00000000-0000-4000-8000-000000000000'),
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Item 4: Timer cleanup evidence via counting scheduler
  // ---------------------------------------------------------------------------

  /**
   * Counting scheduler that records setInterval and clear calls so tests can
   * PROVE timer cleanup rather than inferring from claim absence.
   */
  class CountingScheduler implements PerfScheduler {
    setIntervalCount = 0;
    clearCount = 0;
    callback: (() => Promise<void>) | null = null;

    setInterval(callback: () => Promise<void>, _ms: number): PerfTimerHandle {
      this.setIntervalCount++;
      this.callback = callback;
      return {
        unref: () => {},
        clear: () => {
          this.clearCount++;
        },
      };
    }
  }

  describe('InteractivePerfRuntime — timer cleanup evidence via counting scheduler (Item 4)', () => {
    it('dispose() clears the timer (clearCount increments)', async () => {
      const scheduler = new CountingScheduler();
      const runtime = createInteractivePerfRuntime(
        makeOptions({
          runUuid: '00000000-0000-4000-8000-000000000001',
          __schedulerForTesting: scheduler,
        }),
      );
      await runtime!.start();

      // Timer was started.
      expect(scheduler.setIntervalCount).toBe(1);
      expect(scheduler.clearCount).toBe(0);

      await runtime!.dispose();

      // Timer was cleared on dispose.
      expect(scheduler.clearCount).toBe(1);
    });

    it('startup rollback clears the timer when retention.start fails', async () => {
      const scheduler = new CountingScheduler();
      const runtime = createInteractivePerfRuntime(
        makeOptions({
          runUuid: '00000000-0000-4000-8000-000000000002',
          __schedulerForTesting: scheduler,
          __retentionFsForTesting: new InternalErrorRetentionFs(),
        }),
      );
      expect(runtime).not.toBe(null);

      // start() should reject because retention.start fails.
      let startError: unknown = null;
      try {
        await runtime!.start();
      } catch (err) {
        startError = err;
      }
      expect(startError).not.toBe(null);

      // Timer was never started (retention.start fails before scheduler).
      expect(scheduler.setIntervalCount).toBe(0);
      expect(scheduler.clearCount).toBe(0);

      // dispose is a no-op.
      await runtime!.dispose();
      expect(scheduler.clearCount).toBe(0);
    });

    it('owner A/B: A timer cleared on A dispose, B timer cleared on B dispose', async () => {
      const schedulerA = new CountingScheduler();
      const schedulerB = new CountingScheduler();

      // Start owner A with its own scheduler.
      const ownerA = createInteractivePerfRuntime(
        makeOptions({
          runUuid: '00000000-0000-4000-8000-000000000003',
          __schedulerForTesting: schedulerA,
        }),
      );
      await ownerA!.start();
      expect(schedulerA.setIntervalCount).toBe(1);
      expect(schedulerA.clearCount).toBe(0);

      // Dispose A — timer cleared.
      await ownerA!.dispose();
      expect(schedulerA.clearCount).toBe(1);

      // Start owner B with its own scheduler (A is already gone).
      const ownerB = createInteractivePerfRuntime(
        makeOptions({
          runUuid: '00000000-0000-4000-8000-000000000004',
          __schedulerForTesting: schedulerB,
        }),
      );
      await ownerB!.start();
      expect(schedulerB.setIntervalCount).toBe(1);
      expect(schedulerB.clearCount).toBe(0);

      // Dispose B — timer cleared.
      await ownerB!.dispose();
      expect(schedulerB.clearCount).toBe(1);

      // A's timer was cleared once, B's timer was cleared once.
      expect(schedulerA.clearCount).toBe(1);
      expect(schedulerB.clearCount).toBe(1);
    });
  });
});
