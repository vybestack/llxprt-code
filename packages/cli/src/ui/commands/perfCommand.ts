/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/perf` slash command (P11, issue #3167).
 *
 * Subcommands:
 *   /perf inspect  — where data lives, what fields, sample counts
 *   /perf report   — longitudinal buildReport() output (optional --baseline)
 *   /perf delete   — remove all perf files (with live-writer safety)
 *
 * No args (bare `/perf`) produces a snapshot of THIS process (live MemoryRing
 * + active operation summary) through an injected `PerfSnapshotCapability`.
 * No unowned global singleton — P12 wires the production capability. When
 * unavailable/disabled, the snapshot says so honestly.
 *
 * inspect / report / delete operate on the canonical global log/perf directory
 * via `Storage.getGlobalLogDir()/perf`, but accept an injected dir/deps for
 * behavioral tests.
 */

import { join } from 'node:path';
import type {
  MessageActionReturn,
  SlashCommand,
  CommandContext,
} from './types.js';
import { CommandKind } from './types.js';
import { getHistoryServiceFromConfig } from './historyServiceAccess.js';
import { formatHistoryMemoryBreakdown } from './perfMemoryBreakdown.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  perfInspect,
  formatInspect,
  buildReport,
  formatReport,
  perfDelete,
  formatDeleteResult,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type {
  PerfInspectResult,
  ReportResult,
  ReportSelfHealth,
  PerfDeleteResult,
  PerfDeleteOptions,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';

// ---------------------------------------------------------------------------
// Perf snapshot capability (injected runtime — NOT a global singleton)
// ---------------------------------------------------------------------------

/**
 * Injectable perf directory operations. Defaults to the real telemetry
 * functions; tests pass a custom implementation to assert error handling
 * without global patching. There is no global singleton.
 */
export interface PerfOperations {
  inspect(dir: string): Promise<PerfInspectResult>;
  report(
    dir: string,
    baseline?: string,
    selfHealth?: Partial<ReportSelfHealth>,
    tokenUsageDir?: string,
  ): Promise<ReportResult>;
  delete(options: PerfDeleteOptions): Promise<PerfDeleteResult>;
}

/** Default operations backed by the real telemetry functions. */
const defaultOperations: PerfOperations = {
  inspect: (dir) => perfInspect(dir),
  report: (dir, baseline, selfHealth, tokenUsageDir) =>
    buildReport(dir, baseline, selfHealth, tokenUsageDir),
  delete: (options) => perfDelete(options),
};

/**
 * Returns true for a genuine external errno I/O failure (has a Node errno
 * code). Non-errno internal/programming errors return false so callers can
 * allow them to reject rather than swallowing them as user-facing messages.
 */
function isErrnoError(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === 'string'
  );
}

/**
 * A single live memory sample from the current process ring.
 */
export interface PerfSnapshotSample {
  readonly rss: number;
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
  readonly uptimeMs: number;
  readonly msSinceLastOperation: number;
  readonly timestampMs: number;
}

/**
 * Active-process self-health exposed for the `/perf report` view.
 * `lastWriteErrorCode` is null when the last write succeeded; a string errno
 * when it failed. `evictionCount` is 0 when no evictions occurred. These are
 * known values — the report distinguishes them from `undefined` (unavailable),
 * which occurs when no active runtime capability exists.
 */
export interface PerfSelfHealth {
  readonly lastWriteErrorCode: string | null;
  readonly evictionCount: number;
}

/**
 * A snapshot of the current process for the bare `/perf` view and report
 * self-health. P12 constructs and injects this when perf telemetry is enabled.
 */
export interface PerfSnapshotCapability {
  /** Returns the live memory ring samples (oldest→newest), or null if unavailable. */
  getMemorySnapshot(): readonly PerfSnapshotSample[] | null;
  /** Returns a summary of the active operation, or null if none. */
  getActiveOperationSummary(): {
    readonly provider: string;
    readonly model: string;
    readonly elapsedMs: number;
  } | null;
  /** Returns active-process self-health (known null/0 values). */
  getSelfHealth(): PerfSelfHealth;
}

export interface PerfCommandOptions {
  /** Injected live snapshot capability. When null/undefined, bare /perf says unavailable. */
  readonly snapshotCapability?: PerfSnapshotCapability | null;
  /** Override the perf directory for tests. Defaults to Storage.getGlobalLogDir()/perf. */
  readonly perfDir?: string;
  /**
   * Token-usage JSONL directory for the read-time continuation join. When
   * provided, /perf report streams and aggregates token rows by operation id.
   * Production wires join(config.getProjectTempDir(), 'token-usage').
   */
  readonly tokenUsageDir?: string;
  /** Injectable directory operations. Defaults to the real telemetry functions. */
  readonly operations?: PerfOperations;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedReportArgs {
  readonly baseline: string | undefined;
  readonly error: string | undefined;
}

/**
 * Parses `/perf report` arguments. Accepts `--baseline <value>` (exact version
 * or sha). Rejects malformed args with a useful error message.
 */
function parseReportArgs(args: string): ParsedReportArgs {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  let baseline: string | undefined;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '--baseline') {
      i++;
      if (i >= tokens.length) {
        return {
          baseline: undefined,
          error: '--baseline requires a value (version or git sha)',
        };
      }
      const value = tokens[i];
      if (value.startsWith('--')) {
        return {
          baseline: undefined,
          error: `--baseline requires a value, got flag '${value}'`,
        };
      }
      baseline = value;
      i++;
    } else {
      return {
        baseline: undefined,
        error: `unexpected argument '${token}'. Usage: /perf report [--baseline <version|sha>]`,
      };
    }
  }

  return { baseline, error: undefined };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function messageInfo(content: string): MessageActionReturn {
  return { type: 'message', messageType: 'info', content };
}

function messageError(content: string): MessageActionReturn {
  return { type: 'message', messageType: 'error', content };
}

function getDefaultPerfDir(): string {
  return join(Storage.getGlobalLogDir(), 'perf');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KiB`;
  return `${sign}${(abs / (1024 * 1024)).toFixed(1)} MiB`;
}

// ---------------------------------------------------------------------------
// Live snapshot formatter
// ---------------------------------------------------------------------------

function formatSnapshot(
  capability: PerfSnapshotCapability,
): MessageActionReturn {
  const memSamples = capability.getMemorySnapshot();
  const activeOp = capability.getActiveOperationSummary();
  const lines: string[] = [];

  lines.push('Perf Snapshot (this process)');
  lines.push('============================');
  lines.push('');

  if (activeOp !== null) {
    lines.push('Active operation:');
    lines.push(`  provider: ${activeOp.provider}`);
    lines.push(`  model: ${activeOp.model}`);
    lines.push(`  elapsed: ${activeOp.elapsedMs} ms`);
    lines.push('');
  } else {
    lines.push('No active operation.');
    lines.push('');
  }

  if (memSamples !== null && memSamples.length > 0) {
    const latest = memSamples[memSamples.length - 1];
    const first = memSamples[0];
    lines.push(`Memory samples: ${memSamples.length}`);
    lines.push(`  latest rss: ${formatBytes(latest.rss)}`);
    lines.push(`  latest heap: ${formatBytes(latest.heapUsed)}`);
    lines.push(`  uptime: ${(latest.uptimeMs / 1000).toFixed(1)}s`);
    lines.push(
      `  idle: ${(latest.msSinceLastOperation / 1000).toFixed(1)}s since last operation`,
    );
    if (memSamples.length >= 2) {
      const rssDelta = latest.rss - first.rss;
      const uptimeDelta = latest.uptimeMs - first.uptimeMs;
      if (uptimeDelta > 0) {
        const perMin = (rssDelta / uptimeDelta) * 60_000;
        lines.push(
          `  trend: ${rssDelta >= 0 ? '+' : ''}${formatBytes(rssDelta)} over ${(uptimeDelta / 1000).toFixed(1)}s (${perMin >= 0 ? '+' : ''}${formatBytes(perMin)}/min)`,
        );
      }
    }
  } else {
    lines.push('No memory samples collected.');
  }

  return messageInfo(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

/**
 * Creates the inspect subcommand for the perf directory.
 *
 * Genuine external errno I/O failures are converted to a user-facing error
 * message; non-errno internal/programming errors are allowed to reject so they
 * surface as bugs rather than being swallowed.
 */
/**
 * `/perf memory` — what the retained conversation is holding, by block type,
 * tool, and individual response. Unlike the rest of `/perf` this reads live
 * session state rather than stored perf files, so it needs no telemetry
 * settings to be enabled.
 */
function createMemorySubCommand(): SlashCommand {
  return {
    name: 'memory',
    description: 'Show retained conversation size by block type and tool',
    kind: CommandKind.BUILT_IN,
    action: (context: CommandContext): MessageActionReturn => {
      const historyService = getHistoryServiceFromConfig(
        context.services.config,
      );
      if (historyService === null) {
        return messageInfo(
          'History is not available. Start a conversation first.',
        );
      }
      return messageInfo(
        formatHistoryMemoryBreakdown(historyService.getRawHistory()),
      );
    },
  };
}

function createInspectSubCommand(
  perfDir: string,
  operations: PerfOperations,
): SlashCommand {
  return {
    name: 'inspect',
    description: 'Show where perf data lives and sample counts',
    kind: CommandKind.BUILT_IN,
    action: async (): Promise<MessageActionReturn> => {
      try {
        const result = await operations.inspect(perfDir);
        return messageInfo(formatInspect(result));
      } catch (err) {
        if (isErrnoError(err)) {
          return messageError(`Failed to inspect perf data: ${err.message}`);
        }
        throw err;
      }
    },
  };
}

/**
 * Creates the report subcommand for the perf directory.
 *
 * Passes active self-health (from the snapshot capability when available) and
 * the token-usage directory to telemetry buildReport so the report reflects
 * live sink/retention state and the read-time continuation join. When the
 * capability is unavailable, self-health is undefined (formatted as
 * "unavailable" rather than falsely claiming null/0).
 *
 * Genuine external errno I/O failures are converted to a user-facing error
 * message; non-errno internal/programming errors are allowed to reject.
 */
function createReportSubCommand(
  perfDir: string,
  operations: PerfOperations,
  getSelfHealth: () => PerfSelfHealth | null,
  tokenUsageDir: string | undefined,
): SlashCommand {
  return {
    name: 'report',
    description:
      'Show longitudinal perf trends (optionally vs a --baseline version or sha)',
    kind: CommandKind.BUILT_IN,
    action: async (
      _ctx: CommandContext,
      reportArgs: string,
    ): Promise<MessageActionReturn> => {
      const parsed = parseReportArgs(reportArgs);
      if (parsed.error !== undefined) {
        return messageError(parsed.error);
      }
      try {
        const selfHealth = getSelfHealth() ?? undefined;
        const result = await operations.report(
          perfDir,
          parsed.baseline,
          selfHealth,
          tokenUsageDir,
        );
        return messageInfo(formatReport(result));
      } catch (err) {
        if (isErrnoError(err)) {
          return messageError(`Failed to generate perf report: ${err.message}`);
        }
        throw err;
      }
    },
  };
}

/**
 * Creates the delete subcommand for the perf directory.
 *
 * Genuine external errno I/O failures are converted to a user-facing error
 * message; non-errno internal/programming errors are allowed to reject.
 */
function createDeleteSubCommand(
  perfDir: string,
  operations: PerfOperations,
): SlashCommand {
  return {
    name: 'delete',
    description: 'Delete perf data files (respects active writers)',
    kind: CommandKind.BUILT_IN,
    action: async (): Promise<MessageActionReturn> => {
      try {
        const result = await operations.delete({ dir: perfDir });
        return messageInfo(formatDeleteResult(result));
      } catch (err) {
        if (isErrnoError(err)) {
          return messageError(`Failed to delete perf data: ${err.message}`);
        }
        throw err;
      }
    },
  };
}

/**
 * Creates the `/perf` slash command. Accepts an optional snapshot capability,
 * perf directory override, token-usage directory, and injectable operations
 * for testing. When no snapshot capability is provided, bare `/perf` reports
 * that perf telemetry is not active. `/perf report` still works on stored
 * data with unavailable self-health and the configured token-usage directory.
 */
export function createPerfCommand(
  options: PerfCommandOptions = {},
): SlashCommand {
  const perfDir = options.perfDir ?? getDefaultPerfDir();
  const snapshotCapability = options.snapshotCapability ?? null;
  const operations = options.operations ?? defaultOperations;
  const tokenUsageDir = options.tokenUsageDir;
  const getSelfHealth = (): PerfSelfHealth | null =>
    snapshotCapability?.getSelfHealth() ?? null;

  return {
    name: 'perf',
    description:
      'Performance telemetry: inspect, report, delete, or snapshot this process',
    kind: CommandKind.BUILT_IN,
    action: async (
      _context: CommandContext,
      args: string,
    ): Promise<MessageActionReturn> => {
      const trimmed = args.trim();
      if (trimmed === '') {
        if (snapshotCapability === null) {
          return messageInfo(
            'Perf telemetry is not active in this process. Use /perf inspect to view stored data, or /perf report for trends.',
          );
        }
        return formatSnapshot(snapshotCapability);
      }
      return messageError(
        `Unknown subcommand. Usage: /perf [inspect|report|delete|memory]`,
      );
    },
    subCommands: [
      createInspectSubCommand(perfDir, operations),
      createReportSubCommand(perfDir, operations, getSelfHealth, tokenUsageDir),
      createDeleteSubCommand(perfDir, operations),
      createMemorySubCommand(),
    ],
  };
}

/**
 * Default `/perf` command instance registered in BuiltinCommandLoader.
 * The production snapshot capability is wired by BuiltinCommandLoader via
 * `createPerfCommand({ snapshotCapability })`.
 */
export const perfCommand: SlashCommand = createPerfCommand();
