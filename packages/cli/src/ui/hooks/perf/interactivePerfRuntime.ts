/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interactive perf runtime owner/factory (P12, issue #3167).
 *
 * Constructible at the CLI composition boundary. Disabled mode returns null
 * BEFORE any construction (no UUID, no directory creation, no sink/retention/
 * claim/registry/ring/controller/observer/performance.now/memoryUsage/timer).
 *
 * Enabled mode owns: run UUID, PerfRetention, PerfSink,
 * OperationLifecycleRegistry, optional MemoryTelemetryController, stdout/render
 * observer installation, live snapshot capability, and deterministic
 * disposal/draining.
 *
 * Canonical production directory is join(Storage.getGlobalLogDir(), 'perf').
 *
 * Not a global singleton: the composition root constructs one per rendered
 * instance. Disposal order stops new observations and preserves accepted
 * writes: identity-safe registry observer clear/dispose/drain, memory-controller
 * drain, then sink/retention disposal.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type {
  PerfSinkFilesystem,
  PerfRetentionFilesystem,
  PerfScheduler,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type {
  PerfSnapshotSample,
  PerfSnapshotCapability,
  PerfSelfHealth,
} from '../../commands/perfCommand.js';
import { OperationLifecycleRegistry } from '../agentStream/operationLifecycle.js';
import type {
  OperationIdentityProvider,
  OperationIdentitySnapshot,
} from '../agentStream/operationLifecycle.js';
import { MemoryTelemetryController } from '../memoryTrend/memoryTelemetry.js';

// ---------------------------------------------------------------------------
// Identity provider factory
// ---------------------------------------------------------------------------

/**
 * Truly immutable fields captured exactly once after enablement. These do
 * not change for the process lifetime (foreground parent/subagent are null).
 */
export interface InteractivePerfImmutableInputs {
  readonly sessionId: string;
  readonly runtimeId: string;
  readonly projectHash: string;
  readonly cliVersion: string;
  readonly gitSha: string;
  readonly runtime: string;
  /**
   * Platform with architecture, e.g. 'darwin-arm64'. Includes process.arch
   * honestly rather than only process.platform.
   */
  readonly platform: string;
}

/**
 * Getter-capable inputs for fields that may change between operations.
 * provider/model/terminal geometry are read fresh at each registry.begin
 * via these getters so persisted records show each operation's actual values.
 */
export interface InteractivePerfMutableInputs {
  readonly provider: () => string;
  readonly model: () => string;
  readonly terminalCols: () => number;
  readonly terminalRows: () => number;
  readonly renderMode: () => string;
}

/**
 * Raw identity inputs collected from real runtime/config/build APIs at the
 * composition boundary. Immutable fields are captured once; mutable fields
 * are provided as getters so each operation snapshots current values.
 */
export interface InteractivePerfIdentityInputs {
  readonly sessionId: string;
  readonly runtimeId: string;
  readonly projectHash: string;
  readonly cliVersion: string;
  readonly gitSha: string;
  readonly runtime: string;
  readonly platform: string;
  readonly provider: string;
  readonly model: string;
  readonly terminalCols: number;
  readonly terminalRows: number;
  readonly renderMode: string;
}

/**
 * Creates an identity provider that snapshots CURRENT provider/model/terminal
 * geometry at each call (registry.begin) rather than freezing startup values.
 * Immutable fields (session/runtime/project/build) are fixed once after
 * enablement.
 */
export function createIdentityProvider(
  inputs: InteractivePerfIdentityInputs,
): OperationIdentityProvider {
  return createIdentityProviderFromGetters(
    {
      sessionId: inputs.sessionId,
      runtimeId: inputs.runtimeId,
      projectHash: inputs.projectHash,
      cliVersion: inputs.cliVersion,
      gitSha: inputs.gitSha,
      runtime: inputs.runtime,
      platform: inputs.platform,
    },
    {
      provider: () => inputs.provider,
      model: () => inputs.model,
      terminalCols: () => inputs.terminalCols,
      terminalRows: () => inputs.terminalRows,
      renderMode: () => inputs.renderMode,
    },
  );
}

/**
 * Creates an identity provider from getter-capable mutable inputs. The
 * immutable fields are fixed once; provider/model/terminal geometry are
 * read fresh at each snapshot() call so persisted records reflect each
 * operation's actual values.
 */
export function createIdentityProviderFromGetters(
  immutable: InteractivePerfImmutableInputs,
  mutable: InteractivePerfMutableInputs,
): OperationIdentityProvider {
  return {
    snapshot: (): OperationIdentitySnapshot => ({
      session_id: immutable.sessionId,
      runtime_id: immutable.runtimeId,
      parent_runtime_id: null,
      subagent_name: null,
      project_hash: immutable.projectHash,
      llxprt_version: immutable.cliVersion,
      git_sha: immutable.gitSha,
      runtime: immutable.runtime,
      platform: immutable.platform,
      provider: mutable.provider(),
      model: mutable.model(),
      terminal_cols: mutable.terminalCols(),
      terminal_rows: mutable.terminalRows(),
      render_mode: mutable.renderMode(),
    }),
  };
}

/**
 * Resolves the honest platform string: '<process.platform>-<process.arch>',
 * e.g. 'darwin-arm64'. Includes architecture honestly rather than only
 * process.platform.
 */
export function resolvePlatformArch(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * Derives the exact render-mode value from actual config/settings. Matches
 * the logic in inkRenderOptions.ts:
 *   - screen-reader → 'screen-reader'
 *   - alternateBuffer + incremental → 'incremental'
 *   - alternateBuffer (no incremental) → 'alt-buffer'
 *   - neither → 'plain'
 */
export function resolveRenderMode(
  isScreenReader: boolean,
  useAlternateBuffer: boolean,
  incrementalRendering: boolean,
): string {
  if (isScreenReader) return 'screen-reader';
  if (useAlternateBuffer) {
    return incrementalRendering ? 'incremental' : 'alt-buffer';
  }
  return 'plain';
}

/**
 * Builds the runtime version string: 'bun-<version>' when running under Bun,
 * 'node-<version>' otherwise.
 */
export function resolveRuntimeVersion(): string {
  const bunGlobal = (globalThis as { Bun?: { version: string } }).Bun;
  if (bunGlobal !== undefined) {
    return `bun-${bunGlobal.version}`;
  }
  return `node-${process.version}`;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface InteractivePerfRuntimeOptions {
  /** Master enable. When false, the factory returns null with zero effects. */
  readonly enabled: boolean;
  /** Memory sub-enable (requires enabled). When false, no memory controller. */
  readonly memoryEnabled: boolean;
  /** Perf directory. Defaults to join(Storage.getGlobalLogDir(), 'perf'). */
  readonly perfDir?: string;
  /** Identity provider (P12 constructs this from real runtime/config/build APIs). */
  readonly identityProvider: OperationIdentityProvider;
  /** Test override for the run UUID. Defaults to crypto.randomUUID(). */
  readonly runUuid?: string;
  /** Test override for monotonic clock. */
  readonly monotonicNow?: () => number;
  /** Test override for wall clock. */
  readonly wallNow?: () => number;
  /** Test override for memory sampler. */
  readonly memoryNow?: () => NodeJS.MemoryUsage;
  /**
   * Package-private test seam: a PerfSink filesystem port. When provided,
   * buildRuntimeComponents injects it into the PerfSink so tests can
   * deterministically fail sink.start() with a non-errno internal error.
   */
  readonly __sinkFsForTesting?: PerfSinkFilesystem;
  /**
   * Package-private test seam: a PerfRetention filesystem port. When
   * provided, buildRuntimeComponents injects it into the PerfRetention so
   * tests can deterministically fail retention.start() (claim creation) with
   * a non-errno internal error, proving startup rollback.
   */
  readonly __retentionFsForTesting?: PerfRetentionFilesystem;
  /**
   * Package-private test seam: a PerfScheduler port. When provided,
   * buildRuntimeComponents injects it into PerfRetention so tests can use a
   * counting scheduler that proves timer.clear() is called on startup
   * rollback and on dispose.
   */
  readonly __schedulerForTesting?: PerfScheduler;
}

// ---------------------------------------------------------------------------
// Runtime handle
// ---------------------------------------------------------------------------

export interface InteractivePerfRuntime {
  readonly registry: OperationLifecycleRegistry;
  readonly memoryController: MemoryTelemetryController | null;
  readonly snapshotCapability: PerfSnapshotCapability;
  /**
   * Starts sink/retention (creates claim, starts maintenance interval) and
   * installs observers. Must be called and awaited BEFORE inkRenderOptions()
   * is evaluated so the observer seams are live before the first render.
   */
  start(): Promise<void>;
  /**
   * Ordered disposal: registry observer clear/drain, memory-controller drain,
   * then sink/retention disposal (drains writes + stops maintenance + removes
   * claim). Surfaces internal failures rather than swallowing them.
   */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the interactive perf runtime. Returns null when disabled — BEFORE
 * any UUID generation, directory creation, sink, retention, claim, registry,
 * ring/controller, observer creation, performance.now, memoryUsage, or timer
 * interaction. No side effects in the disabled path.
 */
export function createInteractivePerfRuntime(
  options: InteractivePerfRuntimeOptions,
): InteractivePerfRuntime | null {
  if (!options.enabled) {
    return null;
  }

  const { sink, memoryController, registry, snapshotCapability } =
    buildRuntimeComponents(options);

  let started = false;
  let disposed = false;

  const start = async (): Promise<void> => {
    if (started || disposed) return;
    started = true;
    try {
      await sink.start();
      registry.installObservers();
    } catch (startupError) {
      throw await rollbackStartup(
        startupError,
        registry,
        memoryController,
        sink,
      );
    }
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    try {
      await registry.dispose();
    } catch (err) {
      errors.push(err);
    }
    if (memoryController !== null) {
      try {
        await memoryController.drain();
      } catch (err) {
        errors.push(err);
      }
    }
    try {
      await sink.dispose();
    } catch (err) {
      errors.push(err);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'interactive perf runtime disposal');
    }
  };

  return {
    registry,
    memoryController,
    snapshotCapability,
    start,
    dispose,
  };
}

/**
 * Constructs the concrete runtime components (retention, sink, memory
 * controller, registry, snapshot capability) from options. The enabled check
 * is already done; this builds the real pipeline. Extracted to keep
 * createInteractivePerfRuntime within the max-lines-per-function limit.
 */
function buildRuntimeComponents(options: InteractivePerfRuntimeOptions): {
  sink: PerfSink;
  retention: PerfRetention;
  memoryController: MemoryTelemetryController | null;
  registry: OperationLifecycleRegistry;
  snapshotCapability: PerfSnapshotCapability;
} {
  const perfDir = options.perfDir ?? getDefaultPerfDir();
  const runUuid = options.runUuid ?? randomUUID();
  const retention = new PerfRetention({
    dir: perfDir,
    runUuid,
    maintenanceIntervalMs: 60_000,
    ...(options.__retentionFsForTesting !== undefined
      ? { fs: options.__retentionFsForTesting }
      : {}),
    ...(options.__schedulerForTesting !== undefined
      ? { scheduler: options.__schedulerForTesting }
      : {}),
  });
  const sink = new PerfSink({
    dir: perfDir,
    runUuid,
    retention,
    ...(options.__sinkFsForTesting !== undefined
      ? { fs: options.__sinkFsForTesting }
      : {}),
  });
  const memoryController = options.memoryEnabled
    ? new MemoryTelemetryController({
        sink,
        monotonicNow: options.monotonicNow,
        wallNow: options.wallNow,
        memoryNow: options.memoryNow,
      })
    : null;
  const registry = new OperationLifecycleRegistry({
    identityProvider: options.identityProvider,
    sink,
    retention,
    monotonicNow: options.monotonicNow,
    wallNow: options.wallNow,
    memorySampler: memoryController ?? undefined,
  });
  const snapshotCapability = createSnapshotCapability(
    registry,
    memoryController,
    sink,
    retention,
  );
  return { sink, retention, memoryController, registry, snapshotCapability };
}

/**
 * Rolls back whatever the start() owner created after a sink.start or
 * observer-install failure: registry observers+drain, memory drain, then
 * sink/retention disposal (timer + claim). Always runs all rollback steps;
 * surfaces the original startup error and any internal cleanup errors via
 * AggregateError. External errno cleanup remains fail-open inside sink/
 * retention.
 */
async function rollbackStartup(
  startupError: unknown,
  registry: OperationLifecycleRegistry,
  memoryController: MemoryTelemetryController | null,
  sink: PerfSink,
): Promise<unknown> {
  const cleanupErrors: unknown[] = [];
  try {
    await registry.dispose();
  } catch (err) {
    cleanupErrors.push(err);
  }
  if (memoryController !== null) {
    try {
      await memoryController.drain();
    } catch (err) {
      cleanupErrors.push(err);
    }
  }
  try {
    await sink.dispose();
  } catch (err) {
    cleanupErrors.push(err);
  }
  if (cleanupErrors.length === 0) {
    return startupError;
  }
  return new AggregateError(
    [startupError, ...cleanupErrors],
    'interactive perf runtime startup rolled back',
  );
}

// ---------------------------------------------------------------------------
// Canonical directory
// ---------------------------------------------------------------------------

/**
 * The canonical production perf directory: exactly
 * join(Storage.getGlobalLogDir(), 'perf'). No other path is used.
 */
export function getDefaultPerfDir(): string {
  return join(Storage.getGlobalLogDir(), 'perf');
}

// ---------------------------------------------------------------------------
// Snapshot capability adapter
// ---------------------------------------------------------------------------

/**
 * Snapshot capability adapter. Exposes read-only active-process self-health
 * through the injected sink/retention capability: sink.lastWriteErrorCode
 * (null = no error, string errno = last error) and retention.evictionCount
 * (0 = none). These are known values — the report distinguishes them from
 * undefined (unavailable) which occurs when no active runtime exists.
 */
function createSnapshotCapability(
  registry: OperationLifecycleRegistry,
  memoryController: MemoryTelemetryController | null,
  sink: PerfSink,
  retention: PerfRetention,
): PerfSnapshotCapability {
  return {
    getMemorySnapshot(): readonly PerfSnapshotSample[] | null {
      if (memoryController === null) return null;
      return memoryController.snapshot().map((s) => ({
        rss: s.rss,
        heapUsed: s.heapUsed,
        external: s.external,
        arrayBuffers: s.arrayBuffers,
        uptimeMs: s.uptimeMs,
        msSinceLastOperation: s.msSinceLastOperation,
        timestampMs: s.timestampMs,
      }));
    },
    getActiveOperationSummary() {
      return registry.getActiveOperationSnapshot();
    },
    getSelfHealth(): PerfSelfHealth {
      return {
        lastWriteErrorCode: sink.lastWriteErrorCode,
        evictionCount: retention.evictionCount,
      };
    },
  };
}
