/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real Docker and rootless Podman coverage for #3463. Each suite mounts two
 * sibling workspace roots through the production planners, installs local npm
 * packages into engine-owned dependency volumes for both roots and their
 * declared nested workspaces, and verifies host dependency trees and engine
 * resources are unchanged after cleanup.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildContainerRunArgs } from '../packages/cli/src/utils/sandbox-containers.js';
import { getContainerPath } from '../packages/cli/src/utils/sandbox-env.js';
import {
  addPrivateDependencyMounts,
  planPrivateDependencyMounts,
} from '../packages/cli/src/utils/sandbox-node-modules.js';
import { SANDBOX_DEPENDENCY_RUN_LABEL } from '../packages/cli/src/utils/sandbox-dependency-volumes.js';
import {
  addContainerWorkspaceMounts,
  planContainerWorkspaces,
} from '../packages/cli/src/utils/sandbox-workspaces.js';

type Engine = 'docker' | 'podman';

const IMAGE =
  process.env.LLXPRT_SANDBOX_TEST_IMAGE ??
  'ghcr.io/vybestack/llxprt-code/sandbox:0.11.0';
const TEST_TIMEOUT_MS = 240_000;

function commandSucceeds(command: string, args: readonly string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

function imageIsPresent(engine: Engine): boolean {
  try {
    return (
      execFileSync(engine, ['images', '--quiet', IMAGE], {
        timeout: 30_000,
      })
        .toString()
        .trim() !== ''
    );
  } catch {
    return false;
  }
}

function engineIsReady(engine: Engine): boolean {
  return (
    commandSucceeds(engine, ['info']) &&
    imageIsPresent(engine) &&
    (engine !== 'podman' || podmanIsRootless())
  );
}

function podmanIsRootless(): boolean {
  try {
    return (
      execFileSync(
        'podman',
        ['info', '--format', '{{.Host.Security.Rootless}}'],
        {
          timeout: 30_000,
        },
      )
        .toString()
        .trim() === 'true'
    );
  } catch {
    return false;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

interface HostTreeEntry {
  readonly kind: 'directory' | 'file' | 'symlink';
  readonly value?: string;
}

function snapshotTree(root: string): ReadonlyMap<string, HostTreeEntry> {
  const snapshot = new Map<string, HostTreeEntry>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (entry.isSymbolicLink()) {
        snapshot.set(relativePath, {
          kind: 'symlink',
          value: fs.readlinkSync(fullPath),
        });
      } else if (entry.isDirectory()) {
        snapshot.set(relativePath, { kind: 'directory' });
        walk(fullPath);
      } else {
        snapshot.set(relativePath, {
          kind: 'file',
          value: fs.readFileSync(fullPath, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return snapshot;
}

interface MultiRootFixture {
  readonly home: string;
  readonly primaryRoot: string;
  readonly includeRoot: string;
  readonly sessionTmpdir: string;
  readonly hostDependencyTrees: readonly string[];
  readonly absentDependencyTrees: readonly string[];
}

function buildWorkspaceRoot(root: string, marker: string): void {
  fs.mkdirSync(root, { recursive: true, mode: 0o777 });
  fs.chmodSync(root, 0o777);
  writeJson(path.join(root, 'package.json'), {
    name: `issue3463-${marker}`,
    private: true,
    workspaces: ['packages/nested', 'packages/absent'],
  });
  writeJson(path.join(root, 'packages', 'nested', 'package.json'), {
    name: `issue3463-${marker}-nested`,
    private: true,
  });
  writeJson(path.join(root, 'packages', 'absent', 'package.json'), {
    name: `issue3463-${marker}-absent`,
    private: true,
  });
  writeJson(path.join(root, 'vendor', 'fixture-dep', 'package.json'), {
    name: `issue3463-${marker}-fixture-dep`,
    version: '1.0.0',
    files: ['value.txt'],
  });
  writeText(
    path.join(root, 'vendor', 'fixture-dep', 'value.txt'),
    `${marker}-root-dependency\n`,
  );
  writeJson(path.join(root, 'vendor', 'nested-dep', 'package.json'), {
    name: `issue3463-${marker}-nested-dep`,
    version: '1.0.0',
    files: ['value.txt'],
  });
  writeText(
    path.join(root, 'vendor', 'nested-dep', 'value.txt'),
    `${marker}-nested-dependency\n`,
  );
  writeText(path.join(root, 'source.txt'), `${marker}-source\n`);
  writeText(
    path.join(root, 'node_modules', 'host-root-marker.txt'),
    `${marker}-host-root\n`,
  );
  writeText(
    path.join(
      root,
      'packages',
      'nested',
      'node_modules',
      'host-nested-marker.txt',
    ),
    `${marker}-host-nested\n`,
  );
}

function buildFixture(engine: Engine): MultiRootFixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `issue3463-${engine}-`));
  fs.chmodSync(home, 0o711);
  const primaryRoot = path.join(home, 'primary');
  const includeRoot = path.join(home, 'included');
  buildWorkspaceRoot(primaryRoot, 'primary');
  buildWorkspaceRoot(includeRoot, 'included');
  const sessionTmpdir = path.join(home, 'session-tmp');
  fs.mkdirSync(sessionTmpdir, { mode: 0o777 });
  fs.chmodSync(sessionTmpdir, 0o777);
  const configRoot = path.join(home, 'config');
  fs.mkdirSync(configRoot, { mode: 0o777 });
  fs.chmodSync(configRoot, 0o777);
  return {
    home,
    primaryRoot,
    includeRoot,
    sessionTmpdir,
    hostDependencyTrees: [
      path.join(primaryRoot, 'node_modules'),
      path.join(primaryRoot, 'packages', 'nested', 'node_modules'),
      path.join(includeRoot, 'node_modules'),
      path.join(includeRoot, 'packages', 'nested', 'node_modules'),
    ],
    absentDependencyTrees: [
      path.join(primaryRoot, 'packages', 'absent', 'node_modules'),
      path.join(includeRoot, 'packages', 'absent', 'node_modules'),
    ],
  };
}

function dependencyRunId(args: readonly string[]): string {
  const labels = args.filter(
    (value, index) => index > 0 && args[index - 1] === '--label',
  );
  const prefix = `${SANDBOX_DEPENDENCY_RUN_LABEL}=`;
  const label = labels.find((value) => value.startsWith(prefix));
  if (label === undefined) throw new Error('Missing dependency run label');
  return label.slice(prefix.length);
}

function remainingRunVolumes(engine: Engine, runId: string): readonly string[] {
  const output = execFileSync(
    engine,
    [
      'volume',
      'ls',
      '--quiet',
      '--filter',
      `label=${SANDBOX_DEPENDENCY_RUN_LABEL}=${runId}`,
    ],
    { timeout: 30_000 },
  )
    .toString()
    .trim();
  return output === '' ? [] : output.split(/\r?\n/).sort();
}

function workflowScript(): string {
  return [
    'set -eu',
    'for ROOT in "$1" "$2"; do',
    '  test -f "$ROOT/source.txt"',
    '  test ! -e "$ROOT/node_modules/host-root-marker.txt"',
    '  test ! -e "$ROOT/packages/nested/node_modules/host-nested-marker.txt"',
    '  npm install --prefix "$ROOT" --no-save --package-lock=false --ignore-scripts --no-audit --no-fund --offline "$ROOT/vendor/fixture-dep"',
    '  npm install --prefix "$ROOT/packages/nested" --workspaces=false --no-save --package-lock=false --ignore-scripts --no-audit --no-fund --offline "$ROOT/vendor/nested-dep"',
    '  ROOT_DEP=$(cat "$ROOT/node_modules"/issue3463-*-fixture-dep/value.txt)',
    '  NESTED_DEP=$(cat "$ROOT/packages/nested/node_modules"/issue3463-*-nested-dep/value.txt)',
    '  printf "%s|%s|%s\\n" "$(cat "$ROOT/source.txt")" "$ROOT_DEP" "$NESTED_DEP" > "$ROOT/container-result.txt"',
    'done',
  ].join('\n');
}

function runMultiRootWorkflow(
  engine: Engine,
  fixture: MultiRootFixture,
): {
  readonly runId: string;
  readonly containerName: string;
  readonly resultStatus: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const config = { command: engine, image: IMAGE };
  const workspacePlan = planContainerWorkspaces(fixture.primaryRoot, [
    fixture.primaryRoot,
    fixture.includeRoot,
  ]);
  const includedRoot = workspacePlan.includeRoots[0];
  if (includedRoot === undefined) {
    throw new Error('Expected one planned include workspace root');
  }
  const dependencyPlan = planPrivateDependencyMounts(workspacePlan.roots);
  const args = buildContainerRunArgs(
    config,
    IMAGE,
    fixture.primaryRoot,
    getContainerPath(fixture.primaryRoot),
    fixture.sessionTmpdir,
  );
  const ttyIndex = args.indexOf('-t');
  if (ttyIndex !== -1) args.splice(ttyIndex, 1);
  addContainerWorkspaceMounts(args, workspacePlan);
  const lifecycle = addPrivateDependencyMounts(
    config,
    args,
    workspacePlan.roots,
    dependencyPlan,
  );
  const containerName = `issue3463-${engine}-${randomUUID()}`;
  args.push('--name', containerName);
  lifecycle.recordMainContainerName(containerName);
  const runId = dependencyRunId(args);
  let status: number | null = null;
  let stdout = '';
  let stderr = '';
  try {
    const result = spawnSync(
      engine,
      [
        ...args,
        IMAGE,
        'sh',
        '-c',
        workflowScript(),
        'issue3463-workflow',
        fixture.primaryRoot,
        includedRoot,
      ],
      {
        cwd: fixture.primaryRoot,
        encoding: 'utf8',
        timeout: TEST_TIMEOUT_MS,
        env: {
          ...process.env,
          npm_config_cache: '/tmp/issue3463-npm-cache',
        },
      },
    );
    status = result.status;
    stdout = result.stdout ?? '';
    stderr =
      (result.stderr ?? '') +
      (result.error === undefined ? '' : `\n${String(result.error)}`);
  } finally {
    lifecycle.release();
  }
  return { runId, containerName, resultStatus: status, stdout, stderr };
}

function describeEngine(engine: Engine): void {
  describe.skipIf(!engineIsReady(engine))(
    `Container sandbox multi-root isolation (real ${engine}) #3463`,
    () => {
      let fixture: MultiRootFixture;
      let environmentSnapshot: NodeJS.ProcessEnv;
      let dependencySnapshots: readonly ReadonlyMap<string, HostTreeEntry>[];

      beforeAll(() => {
        environmentSnapshot = { ...process.env };
        fixture = buildFixture(engine);
        process.env.LLXPRT_CONFIG_HOME = path.join(fixture.home, 'config');
        process.env.LLXPRT_CACHE_HOME = path.join(fixture.home, 'cache');
        dependencySnapshots = fixture.hostDependencyTrees.map(snapshotTree);
      });

      afterAll(() => {
        process.env = environmentSnapshot;
        fs.rmSync(fixture.home, { recursive: true, force: true });
      });

      it(
        'reads and writes both roots while package installs stay private and cleanup removes all resources',
        () => {
          const session = runMultiRootWorkflow(engine, fixture);

          if (session.resultStatus !== 0) {
            throw new Error(
              `${engine} multi-root workflow exited with ${String(session.resultStatus)}:\n--- stdout ---\n${session.stdout}\n--- stderr ---\n${session.stderr}`,
            );
          }
          expect(
            fs.readFileSync(
              path.join(fixture.primaryRoot, 'container-result.txt'),
              'utf8',
            ),
          ).toBe(
            'primary-source|primary-root-dependency|primary-nested-dependency\n',
          );
          expect(
            fs.readFileSync(
              path.join(fixture.includeRoot, 'container-result.txt'),
              'utf8',
            ),
          ).toBe(
            'included-source|included-root-dependency|included-nested-dependency\n',
          );
          fixture.hostDependencyTrees.forEach((tree, index) => {
            expect(snapshotTree(tree)).toStrictEqual(
              dependencySnapshots[index],
            );
          });
          expect(
            fixture.absentDependencyTrees.every((tree) => !fs.existsSync(tree)),
          ).toBe(true);
          expect(remainingRunVolumes(engine, session.runId)).toStrictEqual([]);
          expect(
            commandSucceeds(engine, [
              'container',
              'inspect',
              session.containerName,
            ]),
          ).toBe(false);
        },
        TEST_TIMEOUT_MS,
      );
    },
  );
}

describeEngine('docker');
describeEngine('podman');
