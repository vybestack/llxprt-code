/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sentinel guard for the real home directories during Bun test runs
 * (issue #3622).
 *
 * Spawn-time environment redirection isolates env-derived paths structurally.
 * This separate snapshot guard detects sentinel marker changes, watched-dir
 * appearance/disappearance, and entries added or removed in watched dirs.
 * It does not detect reads, in-place overwrites of pre-existing files, nested
 * writes below existing subdirectories, or transient create/delete activity
 * between checks. Direct absolute-path writes can bypass env redirection.
 * Detection while a file runs is best-effort attribution, not proof that the
 * file caused the change; unrelated real-home activity also fails the run.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  resolveGlobalConfigDir,
  resolveGlobalLogDir,
} from '../../packages/storage/src/config/path-resolver.js';

/** Env var that disables the guard (`=0`), for environments where watching the real home is not meaningful. */
export const SENTINEL_GUARD_DISABLE_ENV = 'LLXPRT_TEST_SENTINEL_GUARD';

const SENTINEL_PREFIX = '.llxprt-sentinel-';

/** The exact violation kinds `assertUnchanged` reports. */
export type RealHomeSentinelViolationKind =
  | 'sentinel modified'
  | 'sentinel removed'
  | 'dir appeared'
  | 'non-sentinel entry added'
  | 'non-sentinel entry removed';

/** Thrown by `assertUnchanged`; the message names the test file (label). */
export class RealHomeSentinelViolation extends Error {
  readonly label: string;
  readonly kind: RealHomeSentinelViolationKind;
  readonly targetPath: string;
  readonly detail: string | undefined;

  constructor(properties: {
    readonly label: string;
    readonly kind: RealHomeSentinelViolationKind;
    readonly targetPath: string;
    readonly detail?: string;
    readonly description?: string;
  }) {
    const detail =
      properties.detail === undefined ? '' : ` (${properties.detail})`;
    super(
      `Real-home sentinel violation detected while running ${properties.label} (per-file attribution is best-effort): ${properties.kind} at ${properties.description ?? properties.targetPath} (${properties.targetPath})${detail}`,
    );
    this.name = 'RealHomeSentinelViolation';
    this.label = properties.label;
    this.kind = properties.kind;
    this.targetPath = properties.targetPath;
    this.detail = properties.detail;
  }
}

/** A real-home directory the guard watches. */
export interface SentinelTargetDir {
  readonly path: string;
  readonly description: string;
}

/** The guard protocol the test runners depend on (fakes implement it too). */
export interface SentinelGuard {
  captureBaseline(): void;
  assertUnchanged(label: string): void;
  cleanup(): void;
}

export interface RealHomeSentinelGuardOptions {
  readonly targets: readonly SentinelTargetDir[];
  /** Defaults to a pid+timestamp+random id; injectable for determinism in tests. */
  readonly sessionId?: string;
}

interface WatchedBaseline {
  readonly existed: true;
  readonly target: SentinelTargetDir;
  readonly sentinelPath: string;
  readonly sentinelSha256: string;
  readonly sentinelMtimeMs: number;
  readonly entries: readonly string[];
}

interface AbsentBaseline {
  readonly existed: false;
  readonly target: SentinelTargetDir;
}

type TargetBaseline = WatchedBaseline | AbsentBaseline;

function createSessionId(): string {
  return `p${process.pid}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}

function sha256Hex(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Entries of a watched dir minus every `.llxprt-sentinel-*` file, so a
 * concurrent sibling session dropping its own sentinel can never look like a
 * violation. Sorted for stable diffing.
 */
function listNonSentinelEntries(dirPath: string): string[] {
  return readdirSync(dirPath)
    .filter((name) => !name.startsWith(SENTINEL_PREFIX))
    .sort();
}

function isDirectoryPresent(dirPath: string): boolean {
  try {
    return statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function captureTargetBaseline(
  target: SentinelTargetDir,
  sessionId: string,
): TargetBaseline {
  if (!isDirectoryPresent(target.path)) {
    return { existed: false, target };
  }
  const sentinelPath = join(target.path, `${SENTINEL_PREFIX}${sessionId}`);
  const content = randomBytes(32);
  try {
    writeFileSync(sentinelPath, content);
    return {
      existed: true,
      target,
      sentinelPath,
      sentinelSha256: sha256Hex(content),
      sentinelMtimeMs: statSync(sentinelPath).mtimeMs,
      entries: listNonSentinelEntries(target.path),
    };
  } catch (error) {
    removeSentinel(sentinelPath);
    throw error;
  }
}

function removeSentinel(sentinelPath: string): void {
  try {
    rmSync(sentinelPath, { force: true });
  } catch (error) {
    console.error(
      `Failed to remove sentinel ${sentinelPath}: ${String(error)}`,
    );
  }
}

type ReportChange = (change: RealHomeSentinelViolation) => void;

function inspectBaseline(
  baseline: TargetBaseline,
  label: string,
  report: ReportChange,
): void {
  if (!baseline.existed) {
    if (isDirectoryPresent(baseline.target.path)) {
      report(
        new RealHomeSentinelViolation({
          label,
          kind: 'dir appeared',
          targetPath: baseline.target.path,
          description: baseline.target.description,
        }),
      );
    }
    return;
  }
  inspectSentinel(baseline, label, report);
  if (!isDirectoryPresent(baseline.target.path)) {
    return;
  }
  const current = listNonSentinelEntries(baseline.target.path);
  for (const entry of current.filter(
    (name) => !baseline.entries.includes(name),
  )) {
    report(
      new RealHomeSentinelViolation({
        label,
        kind: 'non-sentinel entry added',
        targetPath: baseline.target.path,
        description: baseline.target.description,
        detail: entry,
      }),
    );
  }
  for (const entry of baseline.entries.filter(
    (name) => !current.includes(name),
  )) {
    report(
      new RealHomeSentinelViolation({
        label,
        kind: 'non-sentinel entry removed',
        targetPath: baseline.target.path,
        description: baseline.target.description,
        detail: entry,
      }),
    );
  }
}

function inspectSentinel(
  baseline: WatchedBaseline,
  label: string,
  report: ReportChange,
): void {
  let mtimeMs: number;
  let content: Buffer;
  try {
    mtimeMs = statSync(baseline.sentinelPath).mtimeMs;
    content = readFileSync(baseline.sentinelPath);
  } catch {
    report(
      new RealHomeSentinelViolation({
        label,
        kind: 'sentinel removed',
        targetPath: baseline.target.path,
        description: baseline.target.description,
        detail: baseline.sentinelPath,
      }),
    );
    return;
  }
  if (
    mtimeMs !== baseline.sentinelMtimeMs ||
    sha256Hex(content) !== baseline.sentinelSha256
  ) {
    report(
      new RealHomeSentinelViolation({
        label,
        kind: 'sentinel modified',
        targetPath: baseline.target.path,
        description: baseline.target.description,
        detail: baseline.sentinelPath,
      }),
    );
  }
}

export class RealHomeSentinelGuard implements SentinelGuard {
  private readonly sessionId: string;
  private readonly targets: readonly SentinelTargetDir[];
  private baselines: readonly TargetBaseline[] = [];
  private readonly observed = new Map<string, RealHomeSentinelViolation>();

  constructor(options: RealHomeSentinelGuardOptions) {
    this.sessionId = options.sessionId ?? createSessionId();
    this.targets = options.targets;
  }

  captureBaseline(): void {
    for (const target of this.targets) {
      const baseline = captureTargetBaseline(target, this.sessionId);
      this.baselines = [...this.baselines, baseline];
    }
  }

  assertUnchanged(label: string): void {
    const fresh: RealHomeSentinelViolation[] = [];
    for (const baseline of this.baselines) {
      inspectBaseline(baseline, label, (change) => {
        const key = JSON.stringify([
          change.targetPath,
          change.kind,
          change.detail,
        ]);
        if (!this.observed.has(key)) {
          this.observed.set(key, change);
          fresh.push(change);
        }
      });
    }
    const first = fresh[0];
    if (first !== undefined) {
      first.message = fresh.map((change) => change.message).join('\n');
      throw first;
    }
  }

  /** Removes only the sentinels this guard dropped; nothing else is touched. */
  cleanup(): void {
    for (const baseline of this.baselines) {
      if (baseline.existed) {
        removeSentinel(baseline.sentinelPath);
      }
    }
  }
}

/**
 * The real-home targets for a runner env: the legacy `~/.llxprt`,
 * `~/.agents/skills`, and the storage package's platform config and log dirs
 * (resolved by the SAME resolver the storage package uses — imported, not
 * reimplemented).
 *
 * When this process is itself already storage-isolated
 * (`LLXPRT_TEST_STORAGE_ISOLATED=1`, e.g. a runner spawned by another
 * runner's tests), the platform dirs resolve inside that isolated temp root;
 * watching them would flag legitimate isolated writes, so only the
 * home-derived targets are watched.
 */
export function resolveRealHomeSentinelTargets(
  env: NodeJS.ProcessEnv,
): readonly SentinelTargetDir[] {
  const homeDir =
    env.HOME !== undefined && env.HOME !== '' ? env.HOME : homedir();
  const targets: SentinelTargetDir[] = [
    { path: join(homeDir, '.llxprt'), description: 'legacy ~/.llxprt' },
    {
      path: join(homeDir, '.agents', 'skills'),
      description: 'user ~/.agents/skills',
    },
  ];
  if (env.LLXPRT_TEST_STORAGE_ISOLATED) {
    return targets;
  }
  const seen = new Set(targets.map((target) => target.path));
  for (const platformDir of [
    {
      path: resolveGlobalConfigDir(),
      description: 'storage platform config dir',
    },
    { path: resolveGlobalLogDir(), description: 'storage platform log dir' },
  ]) {
    if (!seen.has(platformDir.path)) {
      targets.push(platformDir);
      seen.add(platformDir.path);
    }
  }
  return targets;
}

function disabledGuard(): SentinelGuard {
  return {
    captureBaseline: () => {},
    assertUnchanged: () => {},
    cleanup: () => {},
  };
}

/** Builds the run's guard; `LLXPRT_TEST_SENTINEL_GUARD=0` yields a no-op. */
export function createRealHomeSentinelGuard(
  env: NodeJS.ProcessEnv = process.env,
): SentinelGuard {
  if (env[SENTINEL_GUARD_DISABLE_ENV] === '0') {
    return disabledGuard();
  }
  return new RealHomeSentinelGuard({
    targets: resolveRealHomeSentinelTargets(env),
  });
}
