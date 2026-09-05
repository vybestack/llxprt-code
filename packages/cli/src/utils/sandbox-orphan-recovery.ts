/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  DEPENDENCY_VOLUME_NAME_PREFIX,
  SANDBOX_DEPENDENCY_RUN_LABEL,
} from './sandbox-dependency-volumes.js';
import {
  SANDBOX_MANAGED_LABEL_SPEC,
  SANDBOX_OWNER_LABEL,
  parseSandboxOwner,
  sandboxOwnerIsDead,
  type SandboxOwnerMetadata,
} from './sandbox-owner-labels.js';

const RECOVERY_OPERATION_TIMEOUT_MS = 5_000;

type ContainerEngine = 'docker' | 'podman';

interface ManagedContainer {
  readonly id: string;
  readonly owner: SandboxOwnerMetadata | undefined;
  readonly runId: string | undefined;
}

interface ManagedDependencyVolume {
  readonly name: string;
  readonly owner: SandboxOwnerMetadata | undefined;
  readonly runId: string | undefined;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnRecoveryFailure(message: string): void {
  debugLogger.warn(message);
  process.stderr.write(`Warning: ${message}\n`);
}

function execFileOutput(
  engine: ContainerEngine,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      engine,
      args,
      {
        encoding: 'utf8',
        timeout: RECOVERY_OPERATION_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        const detail = stderr.trim();
        reject(
          new Error(
            `${engine} ${args.join(' ')} failed: ${detail === '' ? error.message : detail}`,
          ),
        );
      },
    );
  });
}

function nonEmptyLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line !== '');
}

function firstInspectRecord(
  output: string,
): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed) || parsed.length !== 1) return undefined;
    const record = parsed[0];
    return isUnknownRecord(record) ? record : undefined;
  } catch {
    return undefined;
  }
}

function labelsFrom(
  record: Record<string, unknown>,
  parentKey?: string,
): Record<string, unknown> | undefined {
  let parent: Record<string, unknown> | undefined = record;
  if (parentKey !== undefined) {
    const candidate = record[parentKey];
    parent = isUnknownRecord(candidate) ? candidate : undefined;
  }
  if (parent === undefined || !isUnknownRecord(parent.Labels)) return undefined;
  return parent.Labels;
}

function stringLabel(
  labels: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = labels?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

async function inspectManagedContainer(
  engine: ContainerEngine,
  id: string,
): Promise<ManagedContainer | undefined> {
  let output: string;
  try {
    output = await execFileOutput(engine, ['inspect', id]);
  } catch (error) {
    warnRecoveryFailure(
      `Could not inspect managed ${engine} sandbox ${id} during orphan recovery: ${errorMessage(error)}`,
    );
    return undefined;
  }
  const record = firstInspectRecord(output);
  if (record === undefined) {
    warnRecoveryFailure(
      `Could not inspect managed ${engine} sandbox ${id} during orphan recovery: engine returned invalid JSON`,
    );
    return undefined;
  }
  const labels = labelsFrom(record, 'Config');
  const ownerPayload = stringLabel(labels, SANDBOX_OWNER_LABEL);
  return {
    id,
    owner:
      ownerPayload === undefined ? undefined : parseSandboxOwner(ownerPayload),
    runId: stringLabel(labels, SANDBOX_DEPENDENCY_RUN_LABEL),
  };
}

async function listManagedContainerIds(
  engine: ContainerEngine,
  includeStopped: boolean,
): Promise<string[] | undefined> {
  const args = [
    'ps',
    ...(includeStopped ? ['-a'] : []),
    '--filter',
    `label=${SANDBOX_MANAGED_LABEL_SPEC}`,
    '--format',
    '{{.ID}}',
  ];
  try {
    return nonEmptyLines(await execFileOutput(engine, args));
  } catch (error) {
    warnRecoveryFailure(
      `Could not list managed ${engine} sandboxes for orphan recovery: ${errorMessage(error)}`,
    );
    return undefined;
  }
}

async function reapDeadManagedContainer(
  engine: ContainerEngine,
  id: string,
): Promise<void> {
  const container = await inspectManagedContainer(engine, id);
  if (container?.owner === undefined) return;
  if (!sandboxOwnerIsDead(container.owner)) return;
  try {
    await execFileOutput(engine, ['rm', '-f', id]);
  } catch (error) {
    warnRecoveryFailure(
      `Could not reap orphaned ${engine} sandbox ${id}: ${errorMessage(error)}`,
    );
  }
}

async function reapDeadManagedContainers(
  engine: ContainerEngine,
): Promise<boolean> {
  const ids = await listManagedContainerIds(engine, true);
  if (ids === undefined) return false;
  for (const id of ids) {
    await reapDeadManagedContainer(engine, id);
  }
  return true;
}

async function activeManagedRunIds(
  engine: ContainerEngine,
): Promise<ReadonlySet<string> | undefined> {
  const ids = await listManagedContainerIds(engine, false);
  if (ids === undefined) return undefined;
  const runIds = new Set<string>();
  for (const id of ids) {
    const container = await inspectManagedContainer(engine, id);
    if (container === undefined) return undefined;
    if (container.runId !== undefined) runIds.add(container.runId);
  }
  return runIds;
}

async function listManagedDependencyVolumeNames(
  engine: ContainerEngine,
): Promise<string[] | undefined> {
  try {
    return nonEmptyLines(
      await execFileOutput(engine, [
        'volume',
        'ls',
        '--filter',
        `label=${SANDBOX_MANAGED_LABEL_SPEC}`,
        '--format',
        '{{.Name}}',
      ]),
    );
  } catch (error) {
    warnRecoveryFailure(
      `Could not list managed ${engine} dependency volumes for orphan recovery: ${errorMessage(error)}`,
    );
    return undefined;
  }
}

async function inspectManagedDependencyVolume(
  engine: ContainerEngine,
  name: string,
): Promise<ManagedDependencyVolume | undefined> {
  let output: string;
  try {
    output = await execFileOutput(engine, ['volume', 'inspect', name]);
  } catch (error) {
    warnRecoveryFailure(
      `Could not inspect managed ${engine} dependency volume ${name}: ${errorMessage(error)}`,
    );
    return undefined;
  }
  const record = firstInspectRecord(output);
  if (record === undefined) {
    warnRecoveryFailure(
      `Could not inspect managed ${engine} dependency volume ${name}: engine returned invalid JSON`,
    );
    return undefined;
  }
  const labels = labelsFrom(record);
  const ownerPayload = stringLabel(labels, SANDBOX_OWNER_LABEL);
  return {
    name,
    owner:
      ownerPayload === undefined ? undefined : parseSandboxOwner(ownerPayload),
    runId: stringLabel(labels, SANDBOX_DEPENDENCY_RUN_LABEL),
  };
}

async function reapDeadDependencyVolume(
  engine: ContainerEngine,
  name: string,
  activeRunIds: ReadonlySet<string>,
): Promise<void> {
  if (!name.startsWith(DEPENDENCY_VOLUME_NAME_PREFIX)) return;
  const volume = await inspectManagedDependencyVolume(engine, name);
  if (volume?.owner === undefined || volume.runId === undefined) return;
  if (!sandboxOwnerIsDead(volume.owner)) return;
  if (activeRunIds.has(volume.runId)) return;
  try {
    await execFileOutput(engine, ['volume', 'rm', name]);
  } catch (error) {
    warnRecoveryFailure(
      `Could not reclaim orphaned ${engine} dependency volume ${name}: ${errorMessage(error)}`,
    );
  }
}

async function reapDeadDependencyVolumes(
  engine: ContainerEngine,
  activeRunIds: ReadonlySet<string>,
): Promise<void> {
  const names = await listManagedDependencyVolumeNames(engine);
  if (names === undefined) return;
  for (const name of names) {
    await reapDeadDependencyVolume(engine, name, activeRunIds);
  }
}

/** Reaps provably stale managed containers, then their unattached dependency volumes. */
export async function reapOrphanedSandboxResources(
  config: SandboxConfig,
): Promise<void> {
  if (config.command !== 'docker' && config.command !== 'podman') return;
  const engine = config.command;
  if (!(await reapDeadManagedContainers(engine))) return;
  const activeRunIds = await activeManagedRunIds(engine);
  if (activeRunIds === undefined) return;
  await reapDeadDependencyVolumes(engine, activeRunIds);
}
