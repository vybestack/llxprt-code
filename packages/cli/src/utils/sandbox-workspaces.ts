/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { getContainerPath } from './sandbox-env.js';

export interface ContainerWorkspacePlan {
  readonly primaryRoot: string;
  readonly roots: readonly string[];
  readonly includeRoots: readonly string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveMountableRoot(candidate: string, isPrimary: boolean): string {
  const source = isPrimary
    ? 'primary workspace directory'
    : `--include-directories path '${candidate}'`;
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(candidate);
  } catch (error) {
    throw new FatalSandboxError(
      `Cannot mount ${source}: the path does not exist or cannot be resolved (${errorMessage(error)}). ` +
        'Correct or remove the path and retry.',
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realRoot);
  } catch (error) {
    throw new FatalSandboxError(
      `Cannot mount ${source}: '${realRoot}' cannot be inspected (${errorMessage(error)}). ` +
        'Correct or remove the path and retry.',
    );
  }
  if (!stat.isDirectory()) {
    throw new FatalSandboxError(
      `Cannot mount ${source}: '${realRoot}' is not a mountable directory. ` +
        'Correct or remove the path and retry.',
    );
  }
  if (process.platform !== 'win32' && realRoot.includes(':')) {
    throw new FatalSandboxError(
      `Cannot mount ${source}: '${realRoot}' contains ':' and cannot be represented by Docker or Podman volume mount syntax. ` +
        'Rename or remove the path and retry.',
    );
  }
  try {
    fs.accessSync(
      realRoot,
      fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
    );
  } catch (error) {
    throw new FatalSandboxError(
      `Cannot mount ${source}: '${realRoot}' is not readable, writable, and searchable by LLxprt (${errorMessage(error)}). ` +
        'Grant access or remove the path and retry.',
    );
  }
  return realRoot;
}

function isAncestorOrEqual(ancestor: string, candidate: string): boolean {
  const relative = path.relative(ancestor, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function assertRootsDoNotOverlap(roots: readonly string[]): void {
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < roots.length;
      rightIndex++
    ) {
      const left = roots[leftIndex];
      const right = roots[rightIndex];
      if (isAncestorOrEqual(left, right) || isAncestorOrEqual(right, left)) {
        throw new FatalSandboxError(
          `Container workspace roots overlap: '${left}' and '${right}'. ` +
            'Remove the nested path from --include-directories so each workspace root is distinct.',
        );
      }
    }
  }
}

/**
 * Validates and canonicalizes all workspace roots before a container engine is
 * touched. The primary root keeps its launch spelling for the existing bind;
 * accepted include roots use their real paths and exclude the primary identity.
 *
 * @param workdir Primary container workspace root.
 * @param workspaceDirectories Roots accepted by WorkspaceContext.
 * @returns An immutable workspace mount plan.
 * @throws FatalSandboxError when a root is missing, inaccessible, not a directory, or overlaps another root.
 */
export function planContainerWorkspaces(
  workdir: string,
  workspaceDirectories: readonly string[],
): ContainerWorkspacePlan {
  const primaryRoot = path.resolve(workdir);
  const primaryIdentity = resolveMountableRoot(primaryRoot, true);
  const includeRoots: string[] = [];
  const identities = new Set<string>([primaryIdentity]);

  for (const directory of workspaceDirectories) {
    const identity = resolveMountableRoot(directory, false);
    if (identities.has(identity)) continue;
    identities.add(identity);
    includeRoots.push(identity);
  }

  assertRootsDoNotOverlap([primaryIdentity, ...includeRoots]);
  return {
    primaryRoot,
    roots: [primaryRoot, ...includeRoots],
    includeRoots,
  };
}

/**
 * Appends read-write path-parity binds for every additional workspace root.
 * The caller adds the primary bind before invoking this function.
 *
 * @param args Mutable Docker or Podman argument list.
 * @param plan Validated container workspace plan.
 */
export function addContainerWorkspaceMounts(
  args: string[],
  plan: ContainerWorkspacePlan,
): void {
  for (const includeRoot of plan.includeRoots) {
    args.push('--volume', `${includeRoot}:${getContainerPath(includeRoot)}`);
  }
}
