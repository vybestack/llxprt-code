/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Engine-owned named dependency volumes for the container sandbox (#3450).
 *
 * Host-backed private binds could not be cleaned up by the host after a
 * foreign container uid installed realistic 0755/0644 descendants into
 * them: POSIX lets the writer create content the host user cannot unlink.
 * Engine-owned named volumes move the storage onto the engine's own
 * filesystem, so the engine itself can delete the content when the run
 * releases the volume, whatever uid wrote it.
 *
 * This module holds the engine adapter and the pure argv planners. The
 * launch integration and lifecycle live in sandbox-node-modules.ts.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { addSandboxOwnershipLabels } from './sandbox-owner-labels.js';

export const DEPENDENCY_VOLUME_NAME_PREFIX = 'sandbox-node-modules-';
export const SANDBOX_DEPENDENCY_RUN_LABEL =
  'com.vybestack.llxprt.sandbox-dependency-run';

const INIT_SCRIPT_NAME = 'llxprt-dependency-init';
const INIT_ROOT_TEMPLATE = '/tmp/llxprt-deps-';

/** Bounded engine operations: a wedged engine must not hang the launch. */
export const VOLUME_OPERATION_TIMEOUT_MS = 60_000;
export const INIT_RUN_TIMEOUT_MS = 120_000;
export const CONTAINER_LIST_TIMEOUT_MS = 30_000;
export const CONTAINER_REMOVE_TIMEOUT_MS = 60_000;

export interface EngineCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runEngineCommand(
  engine: 'docker' | 'podman',
  argv: readonly string[],
  timeoutMs: number,
): EngineCommandResult {
  const result = spawnSync(engine, argv, {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: process.env,
  });
  if (result.error !== undefined) {
    return {
      status: result.status,
      stdout: '',
      stderr: result.error.message,
    };
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** The most actionable output an engine produced for a failed operation. */
export function engineFailureDetail(result: EngineCommandResult): string {
  const stderr = result.stderr.trim();
  if (stderr !== '') return stderr;
  const stdout = result.stdout.trim();
  if (stdout !== '') return stdout;
  return `(exit status ${result.status ?? 'unknown'})`;
}

export type EngineContainerListResult =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly detail: string };

/** Container names the engine currently knows, or its actionable failure. */
export function listEngineContainerNames(
  engine: 'docker' | 'podman',
): EngineContainerListResult {
  const result = runEngineCommand(
    engine,
    ['ps', '-a', '--format', '{{.Names}}'],
    CONTAINER_LIST_TIMEOUT_MS,
  );
  if (result.status !== 0) {
    return { ok: false, detail: engineFailureDetail(result) };
  }
  return {
    ok: true,
    names: result.stdout
      .split('\n')
      .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
      .filter((line) => line !== ''),
  };
}

export function createSandboxDependencyRunId(): string {
  return randomUUID();
}

export function addSandboxDependencyRunLabel(
  args: string[],
  runId: string,
): void {
  args.push('--label', `${SANDBOX_DEPENDENCY_RUN_LABEL}=${runId}`);
}

/** One unique volume name per protected destination for this run. */
export function planDependencyVolumeNames(count: number): string[] {
  const base = `${DEPENDENCY_VOLUME_NAME_PREFIX}${randomUUID()}`;
  return Array.from({ length: count }, (_, index) => `${base}-${index}`);
}

/** Neutral image path where the init container sees the i-th volume. */
export function dependencyInitDestination(index: number): string {
  return `${INIT_ROOT_TEMPLATE}${index}`;
}

export function buildDependencyVolumeCreateArgs(
  name: string,
  runId: string,
): string[] {
  const args: string[] = ['volume', 'create'];
  addSandboxOwnershipLabels(args);
  addSandboxDependencyRunLabel(args, runId);
  args.push(name);
  return args;
}

export function buildVolumeMountFlagArg(
  name: string,
  destination: string,
): string {
  return `type=volume,src=${name},dst=${destination}`;
}

/**
 * The init script proves each fresh volume root is empty, then makes it
 * world-writable with the sticky bit (1777, like /tmp): the main container
 * user is selected later and its uid is allowed to differ from the volume
 * creator. `$0` carries the marker name; the roots arrive as `$@`.
 */
export function buildDependencyInitScript(): string {
  return [
    'set -eu',
    'for root in "$@"; do',
    '  if [ -n "$(ls -A "$root")" ]; then',
    '    echo "dependency volume at $root is not empty" >&2',
    '    exit 1',
    '  fi',
    '  chmod 1777 "$root"',
    'done',
  ].join('\n');
}

export interface DependencyInitPlan {
  readonly engine: 'docker' | 'podman';
  readonly image: string;
  readonly initContainerName: string;
  readonly volumes: readonly string[];
  readonly runId: string;
}

/**
 * Argv for the bounded, hardened init container. It runs as engine uid 0
 * before the main sandbox, mounts only the freshly created volumes at
 * neutral image paths, never receives host paths or SANDBOX_FLAGS, and
 * uses the already-selected sandbox image without pulling
 * (`--pull=never` keeps a registry outage out of this path). The argv is
 * compatible with docker and rootless podman.
 */
export function buildDependencyInitRunArgs(plan: DependencyInitPlan): string[] {
  const args: string[] = [
    'run',
    '--rm',
    '--init',
    '--user',
    '0:0',
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
    '--network',
    'none',
    '--pull=never',
  ];
  addSandboxOwnershipLabels(args);
  addSandboxDependencyRunLabel(args, plan.runId);
  args.push('--name', plan.initContainerName);
  plan.volumes.forEach((volume, index) => {
    args.push(
      '--mount',
      buildVolumeMountFlagArg(volume, dependencyInitDestination(index)),
    );
  });
  args.push(
    plan.image,
    'sh',
    '-c',
    buildDependencyInitScript(),
    INIT_SCRIPT_NAME,
    ...plan.volumes.map((_, index) => dependencyInitDestination(index)),
  );
  return args;
}
