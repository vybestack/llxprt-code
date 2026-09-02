/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-container behavioral test for sandbox project dependency isolation
 * (#3450).
 *
 * The engine suites drive the PRODUCTION argument-generation path
 * (`buildContainerRunArgs` + `addContainerVolumeMounts` +
 * `addPrivateDependencyMounts` from packages/cli) and launch a REAL
 * Docker/Podman container with that exact argv. Inside one container
 * session, a fixture Node workspace runs its offline installer, build, and
 * test commands, the issue's exact workflow, so every assertion is on
 * OBSERVED FILESYSTEM STATE (result files, host dependency tree snapshots,
 * leftover private per-run storage), never on hand-built mount flags.
 *
 * A third, gated suite drives the full CLI relaunch path (`--sandbox
 * --sandbox-engine <engine>`) whose entrypoint starts the IMAGE-GLOBAL
 * `llxprt`. It engages only when the image's global CLI actually boots: the
 * registry-published 0.11.0 image (built 2026-08-04, before this tree)
 * cannot start its global CLI standalone because its global install is
 * missing `@ast-grep/napi` and the sharp platform binary, so the gate probes
 * the real image and skips with that reason rather than fabricating a
 * passing agent session. A locally built image (`npm run build:sandbox`)
 * boots and runs the suite.
 *
 * Gating (same conventions as sandboxPrivilege.real.test.ts):
 *   - RUNS whenever each engine is usable and the sandbox image is present
 *     locally; SKIPS only when they genuinely are not.
 *   - Runtime selection honors `LLXPRT_SANDBOX=docker|podman` (set by the
 *     npm scripts) and `LLXPRT_SANDBOX_TEST_RUNTIME=<runtime>`.
 *   - Override the image with `LLXPRT_SANDBOX_TEST_IMAGE=<ref>`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  buildContainerRunArgs,
  addContainerVolumeMounts,
} from '../packages/cli/src/utils/sandbox-containers.js';
import { addPrivateDependencyMounts } from '../packages/cli/src/utils/sandbox-node-modules.js';
import { SANDBOX_DEPENDENCY_RUN_LABEL } from '../packages/cli/src/utils/sandbox-dependency-volumes.js';
import { getContainerPath } from '../packages/cli/src/utils/sandbox-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'cli', 'index.ts');

// One container workflow session on a warm daemon measured well under this;
// the bound exists so a hung runtime fails the test rather than the suite.
const SESSION_TIMEOUT_MS = 180_000;
const AGENT_SESSION_TIMEOUT_MS = 420_000;

// --- runtime + image resolution --------------------------------------------

function resolveSandboxImage(): string {
  if (process.env.LLXPRT_SANDBOX_TEST_IMAGE !== undefined) {
    return process.env.LLXPRT_SANDBOX_TEST_IMAGE;
  }
  try {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', 'cli', 'package.json'), 'utf8'),
    ) as { config?: { sandboxImageUri?: string } };
    if (pkg.config?.sandboxImageUri !== undefined) {
      return pkg.config.sandboxImageUri;
    }
  } catch {
    // fall through to the pinned default
  }
  return 'ghcr.io/vybestack/llxprt-code/sandbox:0.11.0';
}

function commandWorks(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function runtimeUsable(cmd: string): boolean {
  try {
    execFileSync(cmd, ['info'], { stdio: 'ignore', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

function imagePresent(cmd: string, image: string): boolean {
  try {
    const out = execFileSync(cmd, ['images', '-q', image], {
      timeout: 30_000,
    })
      .toString()
      .trim();
    return out !== '';
  } catch {
    return false;
  }
}

/**
 * Engines to exercise: an explicit test override
 * (LLXPRT_SANDBOX_TEST_RUNTIME) wins, then LLXPRT_SANDBOX when it is docker
 * or podman (set by the npm scripts), then every usable engine.
 */
function detectEngines(image: string): string[] {
  const sandboxPref =
    process.env.LLXPRT_SANDBOX === 'docker' ||
    process.env.LLXPRT_SANDBOX === 'podman'
      ? process.env.LLXPRT_SANDBOX
      : undefined;
  const requested = process.env.LLXPRT_SANDBOX_TEST_RUNTIME ?? sandboxPref;
  const candidates =
    requested !== undefined ? [requested] : ['docker', 'podman'];
  return candidates.filter(
    (cmd) =>
      commandWorks(cmd) && runtimeUsable(cmd) && imagePresent(cmd, image),
  );
}

/** Probes whether the image's global llxprt can boot standalone. */
function imageGlobalCliBoots(engine: string, image: string): boolean {
  try {
    // NOT a login shell: `sh -lc` resets PATH to /usr/bin:/bin and cannot
    // see /usr/local/share/npm-global/bin, so it would report every image
    // as unbootable.
    execFileSync(
      engine,
      ['run', '--rm', image, 'sh', '-c', 'timeout 60 llxprt --version'],
      { stdio: 'ignore', timeout: 90_000 },
    );
    return true;
  } catch {
    return false;
  }
}

const IMAGE = resolveSandboxImage();
const ENGINES = detectEngines(IMAGE);

// --- fixture ----------------------------------------------------------------

interface FixtureWorkspace {
  /** The Node workspace the sandbox works in (also the container bind). */
  readonly repoRoot: string;
  /** Isolated LLxprt config/data/cache/log roots for the test process. */
  readonly storageRoot: string;
  /** Responses fixtures for the gated agent-driven suite. */
  readonly responsesRun1: string;
  readonly responsesRun2: string;
  /** Protected host dependency trees snapshotted before launch. */
  readonly protectedHostDirs: readonly string[];
  /** A glob-excluded dependency tree that remains on the shared bind. */
  readonly excludedHostDir: string;
  /** A declared nested root whose node_modules is absent before launch. */
  readonly absentProtectedDir: string;
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeTextFile(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function writeScript(filePath: string, body: string): void {
  writeTextFile(filePath, '#!/bin/sh\nset -e\n' + body);
  chmodSync(filePath, 0o755);
}

function resetFixtureResults(repoRoot: string): void {
  const resultsDir = join(repoRoot, 'results');
  rmSync(resultsDir, { recursive: true, force: true });
  mkdirSync(resultsDir, { mode: 0o777 });
  chmodSync(resultsDir, 0o777);
}

function buildFixture(home: string): FixtureWorkspace {
  const repoRoot = join(home, 'repo');
  const storageRoot = join(home, 'storage');

  // Native Linux resolves absolute module paths through this ancestor after
  // Docker bind-mounts /tmp. Keep the fixture private from listing while
  // allowing the deliberately distinct container UID to traverse to the
  // explicitly shared children.
  chmodSync(home, 0o711);
  // The direct production-argv sessions intentionally run as image or
  // mismatched UIDs, so the shared source bind must model a writable workspace
  // rather than inheriting the host test runner's owner-only write permission.
  mkdirSync(repoRoot, { mode: 0o777 });
  chmodSync(repoRoot, 0o777);
  resetFixtureResults(repoRoot);

  writeJsonFile(join(repoRoot, 'package.json'), {
    name: 'issue3450-fixture',
    private: true,
    workspaces: ['packages/*', 'tools/**', '!packages/excluded/**'],
  });
  writeJsonFile(join(repoRoot, 'packages', 'nested', 'package.json'), {
    name: 'issue3450-nested',
    private: true,
  });
  writeJsonFile(join(repoRoot, 'packages', 'absent', 'package.json'), {
    name: 'issue3450-absent',
    private: true,
  });
  writeJsonFile(join(repoRoot, 'packages', 'excluded', 'package.json'), {
    name: 'issue3468-excluded',
    private: true,
  });
  writeJsonFile(join(repoRoot, 'tools', 'group', 'deep', 'package.json'), {
    name: 'issue3468-deep-tool',
    private: true,
  });

  // Vendored local dependency so the installer needs no registry access.
  writeTextFile(
    join(repoRoot, 'vendor', 'private-dep', 'answer.js'),
    'module.exports = { answer: 42 };\n',
  );

  // Pre-existing benign host markers inside both protected dependency trees.
  // A shebang script in .bin proves the host preflight tolerates benign
  // executable-looking entries. The dangling absolute links point at UNKNOWN
  // host locations (not the validated image-global bun prefix), proving the
  // preflight does not judge them, and the relative links prove symlink
  // targets survive a full session untouched.
  mkdirSync(join(repoRoot, 'node_modules', 'host-pkg'), {
    recursive: true,
  });
  writeTextFile(
    join(repoRoot, 'node_modules', 'host-root-marker.txt'),
    'host-root-marker-3450\n',
  );
  mkdirSync(join(repoRoot, 'node_modules', '.bin'), { recursive: true });
  writeTextFile(
    join(repoRoot, 'node_modules', '.bin', 'host-tool'),
    '#!/usr/bin/env node\nconsole.log("host tool");\n',
  );
  symlinkSync(
    '/usr/bin/issue3450-missing-python3',
    join(repoRoot, 'node_modules', '.bin', 'host-python'),
  );
  symlinkSync('host-pkg', join(repoRoot, 'node_modules', 'host-pkg-link'));
  mkdirSync(join(repoRoot, 'packages', 'nested', 'node_modules'), {
    recursive: true,
  });
  writeTextFile(
    join(
      repoRoot,
      'packages',
      'nested',
      'node_modules',
      'host-nested-marker.txt',
    ),
    'host-nested-marker-3450\n',
  );
  symlinkSync(
    'host-nested-marker.txt',
    join(repoRoot, 'packages', 'nested', 'node_modules', 'nested-marker-link'),
  );
  mkdirSync(join(repoRoot, 'packages', 'nested', 'node_modules', '.bin'), {
    recursive: true,
  });
  symlinkSync(
    '/usr/local/bin/issue3450-missing-nested-tool',
    join(repoRoot, 'packages', 'nested', 'node_modules', '.bin', 'nested-tool'),
  );
  writeTextFile(
    join(
      repoRoot,
      'tools',
      'group',
      'deep',
      'node_modules',
      'host-deep-tool-marker.txt',
    ),
    'host-deep-tool-marker-3468\n',
  );
  writeTextFile(
    join(
      repoRoot,
      'packages',
      'excluded',
      'node_modules',
      'host-excluded-marker.txt',
    ),
    'host-excluded-marker-3468\n',
  );

  // The fixture's offline installer, build, and test commands. Every claim is
  // recorded as a distinct result file so the host test can attribute each
  // observed outcome to one in-container command.
  writeScript(
    join(repoRoot, 'env-check.sh'),
    [
      'mkdir -p results',
      'id -u > results/actual-uid.txt',
      'command -v llxprt > results/llxprt-path.txt',
      'test -x /usr/local/bun/bin/bun',
      'echo ok > results/image-global-ok.txt',
    ].join('\n'),
  );
  writeScript(
    join(repoRoot, 'install.sh'),
    [
      'mkdir -p node_modules/private-dep node_modules/.bin results',
      'cp vendor/private-dep/answer.js node_modules/private-dep/answer.js',
      "printf '#!/bin/sh\\necho install-ok\\n' > node_modules/.bin/fixture-tool",
      'chmod +x node_modules/.bin/fixture-tool',
      'node_modules/.bin/fixture-tool > results/install-ok.txt',
      "printf 'run-one\\n' > node_modules/run1-private-marker.txt",
      // The nested protected tree gets its own private storage in the same
      // run: the installer writes into it and uses what it wrote.
      'mkdir -p packages/nested/node_modules/nested-private-dep packages/nested/node_modules/.bin',
      'cp vendor/private-dep/answer.js packages/nested/node_modules/nested-private-dep/answer.js',
      "printf '#!/bin/sh\\necho nested-install-ok\\n' > packages/nested/node_modules/.bin/nested-tool",
      'chmod +x packages/nested/node_modules/.bin/nested-tool',
      'packages/nested/node_modules/.bin/nested-tool > results/nested-install-ok.txt',
      "printf 'nested-run-one\\n' > packages/nested/node_modules/nested-run1-private-marker.txt",
      'mkdir -p tools/group/deep/node_modules/deep-private-dep',
      'cp vendor/private-dep/answer.js tools/group/deep/node_modules/deep-private-dep/answer.js',
      "printf 'deep-run-one\\n' > tools/group/deep/node_modules/deep-run1-private-marker.txt",
      'if [ ! -e node_modules/host-root-marker.txt ]; then echo hidden > results/host-root-marker-hidden.txt; else echo visible > results/HOST-ROOT-MARKER-VISIBLE-BAD.txt; fi',
      'if [ ! -e packages/nested/node_modules/host-nested-marker.txt ]; then echo hidden > results/host-nested-marker-hidden.txt; else echo visible > results/HOST-NESTED-MARKER-VISIBLE-BAD.txt; fi',
      'if [ ! -e tools/group/deep/node_modules/host-deep-tool-marker.txt ]; then echo hidden > results/host-deep-tool-marker-hidden.txt; else echo visible > results/HOST-DEEP-TOOL-MARKER-VISIBLE-BAD.txt; fi',
      'if [ -e packages/excluded/node_modules/host-excluded-marker.txt ]; then echo visible > results/excluded-marker-visible.txt; else echo hidden > results/EXCLUDED-MARKER-HIDDEN-BAD.txt; fi',
    ].join('\n'),
  );
  writeScript(
    join(repoRoot, 'build.sh'),
    [
      'node -e \'const d = require("./node_modules/private-dep/answer.js"); require("fs").writeFileSync("results/build-ok.txt", "answer=" + d.answer)\'',
      // The later build consumes the nested private dependencies the same
      // installer run wrote: persistence within one session.
      'node -e \'const d = require("./packages/nested/node_modules/nested-private-dep/answer.js"); require("fs").appendFileSync("results/build-ok.txt", " nested-answer=" + d.answer)\'',
      'node -e \'const d = require("./tools/group/deep/node_modules/deep-private-dep/answer.js"); require("fs").appendFileSync("results/build-ok.txt", " deep-answer=" + d.answer)\'',
    ].join('\n'),
  );
  writeScript(
    join(repoRoot, 'test.sh'),
    [
      'grep -q "answer=42" results/build-ok.txt',
      'grep -q "nested-answer=42" results/build-ok.txt',
      'grep -q "deep-answer=42" results/build-ok.txt',
      'test "$(stat -c %a node_modules/private-dep)" = 755',
      'test "$(stat -c %a node_modules/private-dep/answer.js)" = 644',
      'test "$(stat -c %a node_modules/.bin/fixture-tool)" = 755',
      'test "$(stat -c %a packages/nested/node_modules/nested-private-dep)" = 755',
      'test "$(stat -c %a packages/nested/node_modules/nested-private-dep/answer.js)" = 644',
      'test "$(stat -c %a tools/group/deep/node_modules/deep-private-dep/answer.js)" = 644',
      'echo realistic-permissions > results/dependency-modes-ok.txt',
      'echo tests-passed > results/test-ok.txt',
    ].join('\n'),
  );
  writeScript(
    join(repoRoot, 'fresh-check.sh'),
    [
      'mkdir -p results',
      'if [ ! -e node_modules/run1-private-marker.txt ] && [ ! -e packages/nested/node_modules/nested-run1-private-marker.txt ] && [ ! -e tools/group/deep/node_modules/deep-run1-private-marker.txt ]; then echo fresh > results/second-run-fresh.txt; else echo stale > results/SECOND-RUN-STALE-BAD.txt; fi',
    ].join('\n'),
  );

  // Project settings the gated agent-driven suite reads from the mounted
  // workspace: shell tool enabled, telemetry into the shared workspace.
  writeJsonFile(join(repoRoot, '.llxprt', 'settings.json'), {
    general: { enableAutoUpdate: false },
    telemetry: {
      enabled: true,
      outfile: join(repoRoot, 'telemetry.log'),
      logPrompts: true,
      logApiBodies: true,
    },
    tools: { core: ['run_shell_command'] },
    ui: { theme: 'Green Screen' },
    ide: { enabled: false, hasSeenNudge: true },
  });

  // Deterministic local model turns for the gated agent-driven suite. The
  // responses files live INSIDE the fixture repo so the workspace bind makes
  // their absolute path resolve identically in the container; the
  // {{CWD}}-relative shell commands run with the workspace as cwd.
  const toolTurn = (id: string, command: string, description: string): string =>
    JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id,
              name: 'run_shell_command',
              parameters: { command, description },
            },
          ],
        },
      ],
    });
  const finalTurn = JSON.stringify({
    chunks: [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'issue3450 workflow complete' }],
        metadata: {
          usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
        },
      },
    ],
  });

  const responsesRun1 = join(repoRoot, 'fake-responses-run1.jsonl');
  writeFileSync(
    responsesRun1,
    [
      toolTurn(
        'call_env_check',
        './env-check.sh',
        'Check image-global tooling',
      ),
      toolTurn('call_install', './install.sh', 'Run the fixture installer'),
      toolTurn('call_build', './build.sh', 'Build the fixture'),
      toolTurn('call_test', './test.sh', 'Run the fixture tests'),
      finalTurn,
    ].join('\n') + '\n',
  );
  const responsesRun2 = join(repoRoot, 'fake-responses-run2.jsonl');
  writeFileSync(
    responsesRun2,
    [
      toolTurn(
        'call_fresh_check',
        './fresh-check.sh',
        'Check dependency storage freshness',
      ),
      toolTurn('call_install', './install.sh', 'Run the fixture installer'),
      toolTurn('call_build', './build.sh', 'Build the fixture'),
      toolTurn('call_test', './test.sh', 'Run the fixture tests'),
      finalTurn,
    ].join('\n') + '\n',
  );

  for (const dir of ['config', 'data', 'cache', 'log']) {
    mkdirSync(join(storageRoot, dir), { recursive: true });
  }

  return {
    repoRoot,
    storageRoot,
    responsesRun1,
    responsesRun2,
    protectedHostDirs: [
      join(repoRoot, 'node_modules'),
      join(repoRoot, 'packages', 'nested', 'node_modules'),
      join(repoRoot, 'tools', 'group', 'deep', 'node_modules'),
    ],
    excludedHostDir: join(repoRoot, 'packages', 'excluded', 'node_modules'),
    absentProtectedDir: join(repoRoot, 'packages', 'absent', 'node_modules'),
  };
}

// --- host dependency tree snapshots -----------------------------------------

interface TreeEntry {
  readonly kind: 'file' | 'dir' | 'symlink';
  readonly content?: string;
  readonly target?: string;
}

function snapshotTree(
  root: string,
): ReadonlyMap<string, TreeEntry> | undefined {
  if (!existsSync(root)) {
    return undefined;
  }
  const snapshot = new Map<string, TreeEntry>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const rel = fullPath.slice(root.length + 1);
      if (entry.isSymbolicLink()) {
        snapshot.set(rel, { kind: 'symlink', target: readlinkSync(fullPath) });
      } else if (entry.isDirectory()) {
        snapshot.set(rel, { kind: 'dir' });
        walk(fullPath);
      } else {
        snapshot.set(rel, {
          kind: 'file',
          content: readFileSync(fullPath, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return snapshot;
}

function assertTreeUnchanged(
  root: string,
  before: ReadonlyMap<string, TreeEntry> | undefined,
): void {
  expect(snapshotTree(root)).toStrictEqual(before);
}

function hostDependencyCacheRoots(cacheDir: string): string[] {
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir)
    .filter((entry) => entry.startsWith('sandbox-node-modules-'))
    .map((entry) => join(cacheDir, entry));
}

// --- production-argv workflow launcher --------------------------------------

interface WorkflowSession extends LaunchResult {
  readonly runId: string;
  readonly labeledVolumesWhileActive: readonly string[];
  readonly mountedVolumeNames: readonly string[];
  readonly mountedDestinations: readonly string[];
  readonly labeledVolumesAfterRelease: readonly string[];
  readonly hostCacheRootsWhileActive: readonly string[];
  readonly hostCacheRootsAfterRelease: readonly string[];
}

interface WorkflowOptions {
  readonly user?: string;
  readonly whileActive?: () => void;
}

function addNativeLinuxHostUser(args: string[]): void {
  if (process.platform !== 'linux') return;
  args.push(
    '--user',
    `${String(process.getuid())}:${String(process.getgid())}`,
  );
}

function flagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length - 1; index++) {
    if (argv[index] === flag) values.push(argv[index + 1]);
  }
  return values;
}

function labelValue(argv: readonly string[], labelName: string): string {
  const prefix = `${labelName}=`;
  const value = flagValues(argv, '--label').find((label) =>
    label.startsWith(prefix),
  );
  if (value === undefined) throw new Error(`Missing label '${labelName}'`);
  return value.slice(prefix.length);
}

function mountField(spec: string, fieldName: string): string {
  const prefix = `${fieldName}=`;
  const value = spec
    .split(',')
    .find((field) => field.startsWith(prefix))
    ?.slice(prefix.length);
  if (value === undefined) {
    throw new Error(`Mount '${spec}' is missing '${fieldName}'`);
  }
  return value;
}

type DependencyResourceKind = 'container' | 'volume';

function queryDependencyResources(
  engine: string,
  kind: DependencyResourceKind,
  runId?: string,
): string[] {
  const filter =
    runId === undefined
      ? `label=${SANDBOX_DEPENDENCY_RUN_LABEL}`
      : `label=${SANDBOX_DEPENDENCY_RUN_LABEL}=${runId}`;
  const args =
    kind === 'volume'
      ? ['volume', 'ls', '--filter', filter, '--format', '{{.Name}}']
      : ['ps', '-a', '--filter', filter, '--format', '{{.Names}}'];
  const result = spawnSync(engine, args, {
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(
      `Failed to query ${engine} ${kind}s with filter '${filter}' ` +
        `(status ${String(result.status)}).\n` +
        `--- stdout ---\n${result.stdout ?? ''}\n` +
        `--- stderr ---\n${result.stderr ?? ''}\n` +
        `--- spawn error ---\n${result.error?.message ?? ''}`,
    );
  }
  return (result.stdout ?? '')
    .split(/\r?\n/)
    .filter((name) => name !== '')
    .sort();
}

function queryRunVolumes(engine: string, runId: string): string[] {
  return queryDependencyResources(engine, 'volume', runId);
}

function bounded<T>(
  operation: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${description} exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Builds the production container argv in production order, observes the
 * labeled engine volumes while the named main container is alive, then runs
 * the requested workflow and releases the production lifecycle.
 */
async function runSandboxedWorkflow(
  engine: string,
  fixture: FixtureWorkspace,
  innerScript: string,
  options: WorkflowOptions = {},
): Promise<WorkflowSession> {
  const config = { command: engine, image: IMAGE };
  const containerWorkdir = getContainerPath(fixture.repoRoot);
  const args = buildContainerRunArgs(
    config,
    IMAGE,
    fixture.repoRoot,
    containerWorkdir,
    realpathSync(tmpdir()),
  );
  const ttyIndex = args.indexOf('-t');
  if (ttyIndex !== -1) args.splice(ttyIndex, 1);
  addContainerVolumeMounts(args);
  const lifecycle = addPrivateDependencyMounts(config, args, fixture.repoRoot);
  if (options.user === undefined) {
    addNativeLinuxHostUser(args);
  } else {
    args.push('--user', options.user);
  }
  const containerName = `issue3450-${engine}-${randomUUID()}`;
  args.push('--name', containerName);
  lifecycle.recordMainContainerName(containerName);

  const runId = labelValue(args, SANDBOX_DEPENDENCY_RUN_LABEL);
  const mounts = flagValues(args, '--mount');
  const mountedVolumeNames = mounts.map((mount) => mountField(mount, 'src'));
  const mountedDestinations = mounts.map((mount) => mountField(mount, 'dst'));
  const cacheDir = join(fixture.storageRoot, 'cache');
  const readinessMarker = `issue3450-ready-${randomUUID()}`;
  const wrappedScript = [
    `printf '${readinessMarker}\\n'`,
    'read issue3450_release',
    innerScript,
  ].join(' && ');

  let stdout = '';
  let stderr = '';
  let completed = false;
  let readinessObserved = false;
  let observeReadiness: () => void = () => {};
  const readiness = new Promise<void>((resolve) => {
    observeReadiness = resolve;
  });
  const child = spawn(engine, [...args, IMAGE, 'sh', '-c', wrappedScript], {
    cwd: fixture.repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    if (!readinessObserved && stdout.includes(`${readinessMarker}\n`)) {
      readinessObserved = true;
      observeReadiness();
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const completion = new Promise<LaunchResult>((resolve) => {
    child.once('error', (error) => {
      completed = true;
      resolve({ status: null, stdout, stderr: `${stderr}${String(error)}` });
    });
    child.once('close', (status) => {
      completed = true;
      resolve({ status, stdout, stderr });
    });
  });

  let activeVolumes: readonly string[] = [];
  let hostCacheWhileActive: readonly string[] = [];
  let launchResult: LaunchResult = { status: null, stdout: '', stderr: '' };
  try {
    const exitedBeforeReady = completion.then((result) => {
      throw new Error(
        `Container exited before readiness with status ${String(result.status)}.\n` +
          `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
    await bounded(
      Promise.race([readiness, exitedBeforeReady]),
      SESSION_TIMEOUT_MS,
      `${engine} container readiness`,
    );
    activeVolumes = queryRunVolumes(engine, runId);
    hostCacheWhileActive = hostDependencyCacheRoots(cacheDir);
    options.whileActive?.();
    child.stdin.write('release\n');
    child.stdin.end();
    launchResult = await bounded(
      completion,
      SESSION_TIMEOUT_MS,
      `${engine} workflow completion`,
    );
  } finally {
    lifecycle.release();
    if (!completed) child.kill('SIGKILL');
  }

  return {
    ...launchResult,
    runId,
    labeledVolumesWhileActive: activeVolumes,
    mountedVolumeNames,
    mountedDestinations,
    labeledVolumesAfterRelease: queryRunVolumes(engine, runId),
    hostCacheRootsWhileActive: hostCacheWhileActive,
    hostCacheRootsAfterRelease: hostDependencyCacheRoots(cacheDir),
  };
}

const RUN_ONE_SCRIPT = [
  './env-check.sh',
  './install.sh',
  './build.sh',
  './test.sh',
].join(' && ');
const RUN_TWO_SCRIPT = [
  'rm -rf results/*',
  './fresh-check.sh',
  './install.sh',
  './build.sh',
  './test.sh',
].join(' && ');

function expectResultFile(fixture: FixtureWorkspace, name: string): void {
  const filePath = join(fixture.repoRoot, 'results', name);
  expect(existsSync(filePath)).toBe(true);
}

function expectNoBadResultFiles(fixture: FixtureWorkspace): void {
  const resultsDir = join(fixture.repoRoot, 'results');
  if (!existsSync(resultsDir)) {
    return;
  }
  const bad = readdirSync(resultsDir).filter((name) =>
    name.endsWith('-BAD.txt'),
  );
  expect(bad).toStrictEqual([]);
}

/**
 * A protected destination that was absent before launch must STILL be absent
 * after the session: the engine materializes the mountpoint inside the
 * workspace bind while the container runs, and the production cleanup removes
 * that engine-created EMPTY directory after the container exits. Anything
 * else (a surviving directory, a file, content) is a failure.
 */
function assertAbsentProtectedPathStrictlyGone(absentDir: string): void {
  expect(existsSync(absentDir)).toBe(false);
}

interface PlanningFailureObservation {
  readonly errorMessage: string;
  readonly hostMarker: string;
  readonly hostEntries: readonly string[];
  readonly containersBefore: readonly string[];
  readonly containersAfter: readonly string[];
  readonly volumesBefore: readonly string[];
  readonly volumesAfter: readonly string[];
}

function observePlanningFailureBeforeEngineLaunch(
  engine: string,
  workspaces: readonly string[],
  configure: (repoRoot: string, home: string) => void,
): PlanningFailureObservation {
  const home = mkdtempSync(join(tmpdir(), `issue3468-${engine}-prelaunch-`));
  const repoRoot = join(home, 'repo');
  const hostDependencyRoot = join(repoRoot, 'node_modules');
  const hostMarkerPath = join(hostDependencyRoot, 'host-marker.txt');
  mkdirSync(repoRoot, { recursive: true });
  writeJsonFile(join(repoRoot, 'package.json'), {
    name: 'issue3468-prelaunch-fixture',
    private: true,
    workspaces,
  });
  writeTextFile(hostMarkerPath, 'host-marker-before-prelaunch-failure\n');
  configure(repoRoot, home);
  const containersBefore = queryDependencyResources(engine, 'container');
  const volumesBefore = queryDependencyResources(engine, 'volume');
  let lifecycle: ReturnType<typeof addPrivateDependencyMounts> | undefined;
  try {
    let failure: Error | undefined;
    try {
      lifecycle = addPrivateDependencyMounts(
        { command: engine, image: IMAGE },
        [],
        repoRoot,
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failure = error;
    }
    if (failure === undefined) {
      throw new Error('Expected dependency mount planning to fail');
    }
    return {
      errorMessage: failure.message,
      hostMarker: readFileSync(hostMarkerPath, 'utf8'),
      hostEntries: readdirSync(hostDependencyRoot).sort(),
      containersBefore,
      containersAfter: queryDependencyResources(engine, 'container'),
      volumesBefore,
      volumesAfter: queryDependencyResources(engine, 'volume'),
    };
  } finally {
    lifecycle?.release();
    rmSync(home, { recursive: true, force: true });
  }
}

interface LaunchResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function expectPlanningFailurePreservedState(
  observed: PlanningFailureObservation,
): void {
  expect(observed.hostMarker).toBe('host-marker-before-prelaunch-failure\n');
  expect(observed.hostEntries).toStrictEqual(['host-marker.txt']);
  expect(observed.containersAfter).toStrictEqual(observed.containersBefore);
  expect(observed.volumesAfter).toStrictEqual(observed.volumesBefore);
}

function expectLaunchSucceeded(result: LaunchResult): void {
  if (result.status !== 0) {
    throw new Error(
      `Sandbox launch exited with status ${String(result.status)}.\n` +
        `--- stdout ---\n${result.stdout}\n` +
        `--- stderr ---\n${result.stderr}`,
    );
  }
}

function expectEngineVolumeLifecycle(
  session: WorkflowSession,
  fixture: FixtureWorkspace,
): void {
  const expectedDestinations = [
    join(fixture.repoRoot, 'node_modules'),
    fixture.absentProtectedDir,
    join(fixture.repoRoot, 'packages', 'nested', 'node_modules'),
    join(fixture.repoRoot, 'tools', 'group', 'deep', 'node_modules'),
  ].map(getContainerPath);
  expect(session.runId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(session.labeledVolumesWhileActive).toHaveLength(
    expectedDestinations.length,
  );
  expect(new Set(session.labeledVolumesWhileActive).size).toBe(
    expectedDestinations.length,
  );
  expect([...session.mountedVolumeNames].sort()).toStrictEqual(
    session.labeledVolumesWhileActive,
  );
  expect(session.mountedDestinations).toStrictEqual(expectedDestinations);
  expect(session.hostCacheRootsWhileActive).toStrictEqual([]);
  expect(session.labeledVolumesAfterRelease).toStrictEqual([]);
  expect(session.hostCacheRootsAfterRelease).toStrictEqual([]);
}

// --- gated image-global agent launcher ---------------------------------------

type SessionResult = LaunchResult;

function runAgentSession(
  engine: string,
  fixture: FixtureWorkspace,
  responsesFile: string,
): SessionResult {
  // The workspace bind uses the resolved physical path (process.cwd() inside
  // the CLI), and on macOS os.tmpdir() is a /var/folders symlink prefix whose
  // realpath lives under /private/var/folders. Forward the resolved form so
  // the path the in-container CLI reads exists through the bind.
  const responsesPath = realpathSync(responsesFile);
  const useNativeLinuxUser = process.platform === 'linux';
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    // Native Debian/Ubuntu production selects the host UID/GID. Keep that
    // synthetic user's HOME on the writable config mount. On macOS the engine
    // needs the real HOME to locate its VM and image store, and uses its image
    // user as production does by default.
    HOME: useNativeLinuxUser
      ? join(fixture.storageRoot, 'config')
      : process.env.HOME,
    SANDBOX_SET_UID_GID: useNativeLinuxUser ? 'true' : 'false',
    NO_BROWSER: 'true',
    LLXPRT_NO_BROWSER_AUTH: 'true',
    CI: 'true',
    LLXPRT_CONFIG_HOME: join(fixture.storageRoot, 'config'),
    LLXPRT_DATA_HOME: join(fixture.storageRoot, 'data'),
    LLXPRT_CACHE_HOME: join(fixture.storageRoot, 'cache'),
    LLXPRT_LOG_HOME: join(fixture.storageRoot, 'log'),
    LLXPRT_FAKE_RESPONSES: responsesPath,
    // Forward the fake-responses path into the container: the sandbox passes
    // only a fixed set of variables through, and SANDBOX_ENV is the supported
    // channel for additional environment.
    SANDBOX_ENV: `LLXPRT_FAKE_RESPONSES=${responsesPath}`,
  };
  const result = spawnSync(
    process.execPath,
    [
      CLI_ENTRY,
      '--yolo',
      '--ide-mode',
      'disable',
      // --sandbox is a boolean flag; the engine comes from --sandbox-engine.
      // (Passing the engine to --sandbox would parse it as the prompt and
      // auto-detect Seatbelt on macOS instead.)
      '--sandbox',
      '--sandbox-engine',
      engine,
      '--sandbox-image',
      IMAGE,
      '--provider',
      'fake',
      '--model',
      'fake-model',
      'Run the fixture environment check, installer, build, and tests.',
    ],
    {
      cwd: fixture.repoRoot,
      env: childEnv,
      encoding: 'utf8',
      timeout: AGENT_SESSION_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  writeTextFile(
    join(fixture.storageRoot, 'last-session.log'),
    `status: ${String(result.status)}
` +
      `--- stdout ---
${result.stdout ?? ''}
` +
      `--- stderr ---
${result.stderr ?? ''}
`,
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr:
      (result.stderr ?? '') +
      (result.error === undefined ? '' : String(result.error)),
  };
}

// --- the real-engine suites ---------------------------------------------------

function describeEngine(engine: string): void {
  describe.skipIf(!ENGINES.includes(engine))(
    `Sandbox node_modules isolation (real ${engine}) #3450/#3468`,
    () => {
      let fixture: FixtureWorkspace;
      let home: string;
      let beforeSnapshots: ReadonlyMap<string, TreeEntry>[];
      let beforeExcluded: ReadonlyMap<string, TreeEntry>;
      let beforeAbsent: ReadonlyMap<string, TreeEntry> | undefined;
      let savedStorageEnv: NodeJS.ProcessEnv | undefined;

      beforeAll(() => {
        home = mkdtempSync(join(tmpdir(), `issue3450-${engine}-`));
        fixture = buildFixture(home);
        // Isolate the production cache root so each run can prove that engine
        // volumes create no sandbox-node-modules directories on the host.
        savedStorageEnv = {
          LLXPRT_CONFIG_HOME: process.env.LLXPRT_CONFIG_HOME,
          LLXPRT_CACHE_HOME: process.env.LLXPRT_CACHE_HOME,
        };
        process.env.LLXPRT_CONFIG_HOME = join(fixture.storageRoot, 'config');
        process.env.LLXPRT_CACHE_HOME = join(fixture.storageRoot, 'cache');
        beforeSnapshots = fixture.protectedHostDirs.map((dir) => {
          const snapshot = snapshotTree(dir);
          if (snapshot === undefined) {
            throw new Error(`protected host dir missing before launch: ${dir}`);
          }
          return snapshot;
        });
        const excludedSnapshot = snapshotTree(fixture.excludedHostDir);
        if (excludedSnapshot === undefined) {
          throw new Error(
            `excluded host dir missing before launch: ${fixture.excludedHostDir}`,
          );
        }
        beforeExcluded = excludedSnapshot;
        beforeAbsent = snapshotTree(fixture.absentProtectedDir);
      });

      afterAll(() => {
        if (savedStorageEnv !== undefined) {
          for (const [key, value] of Object.entries(savedStorageEnv)) {
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        }
        if (home !== undefined && home !== '') {
          if (process.env.ISSUE3450_KEEP !== undefined) return;
          rmSync(home, { recursive: true, force: true });
        }
      });

      it('rejects a positive glob with no package roots before engine launch', () => {
        const observed = observePlanningFailureBeforeEngineLaunch(
          engine,
          ['packages/*'],
          () => {},
        );

        expect(observed.errorMessage).toContain(
          "Workspace glob 'packages/*' matched no package roots",
        );
        expectPlanningFailurePreservedState(observed);
      });

      it('rejects unsupported glob syntax before engine launch', () => {
        const observed = observePlanningFailureBeforeEngineLaunch(
          engine,
          ['packages/{one,two}'],
          () => {},
        );

        expect(observed.errorMessage).toContain(
          "Unsupported workspace glob 'packages/{one,two}'",
        );
        expect(observed.errorMessage).toContain("'*' as a complete segment");
        expectPlanningFailurePreservedState(observed);
      });

      it('rejects an excluded glob-selected symlink escape before engine launch', () => {
        const observed = observePlanningFailureBeforeEngineLaunch(
          engine,
          ['packages/*', '!packages/escaped'],
          (repoRoot, fixtureHome) => {
            const outside = join(fixtureHome, 'outside-package');
            writeJsonFile(join(outside, 'package.json'), {
              name: 'issue3468-escaped-package',
            });
            mkdirSync(join(repoRoot, 'packages'), { recursive: true });
            symlinkSync(outside, join(repoRoot, 'packages', 'escaped'));
          },
        );

        expect(observed.errorMessage).toContain(
          'resolves outside the workspace',
        );
        expectPlanningFailurePreservedState(observed);
      });

      it(
        'one sandbox session installs, builds, and tests against private dependencies',
        async () => {
          const session = await runSandboxedWorkflow(
            engine,
            fixture,
            RUN_ONE_SCRIPT,
          );
          expectLaunchSucceeded(session);
          expectEngineVolumeLifecycle(session, fixture);

          // The image-global llxprt and /usr/local/bun stayed available (not
          // over-mounted by the private dependency binds).
          expectResultFile(fixture, 'image-global-ok.txt');
          // The in-container installer ran and used the private mounts.
          expectResultFile(fixture, 'install-ok.txt');
          // The nested protected tree got its own private storage in the
          // same run.
          expectResultFile(fixture, 'nested-install-ok.txt');
          // Later commands in the same run used what the installer wrote,
          // in both the root and the nested private tree.
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          expect(
            readFileSync(
              join(fixture.repoRoot, 'results', 'build-ok.txt'),
              'utf8',
            ),
          ).toBe('answer=42 nested-answer=42 deep-answer=42');
          // Positive glob matches are hidden; the exclusion remains shared.
          expectResultFile(fixture, 'host-root-marker-hidden.txt');
          expectResultFile(fixture, 'host-nested-marker-hidden.txt');
          expectResultFile(fixture, 'host-deep-tool-marker-hidden.txt');
          expectResultFile(fixture, 'excluded-marker-visible.txt');
          expectNoBadResultFiles(fixture);

          // Source output outside node_modules is shared: the in-container
          // result files exist in the original host repository.
          expect(
            existsSync(join(fixture.repoRoot, 'results', 'build-ok.txt')),
          ).toBe(true);

          // Host dependency trees are byte-for-byte unchanged after exit: the
          // container consumed only private storage, never the host trees.
          expect(
            existsSync(join(fixture.repoRoot, 'node_modules', 'private-dep')),
          ).toBe(false);
          expect(
            existsSync(
              join(fixture.repoRoot, 'node_modules', 'run1-private-marker.txt'),
            ),
          ).toBe(false);
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertTreeUnchanged(fixture.excludedHostDir, beforeExcluded);
          // A protected host path that was absent before launch gained
          // nothing from the session.
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(beforeAbsent).toBeUndefined();
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'a second run starts with fresh private dependency storage',
        async () => {
          const session = await runSandboxedWorkflow(
            engine,
            fixture,
            RUN_TWO_SCRIPT,
          );
          expectLaunchSucceeded(session);
          expectEngineVolumeLifecycle(session, fixture);

          expectResultFile(fixture, 'second-run-fresh.txt');
          expectNoBadResultFiles(fixture);

          // The second run repeated the full workflow against its own private
          // dependencies and still left the host trees untouched.
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertTreeUnchanged(fixture.excludedHostDir, beforeExcluded);
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'shows host source edits inside the running container',
        async () => {
          const hostEditPath = join(fixture.repoRoot, 'host-live-edit.txt');
          const session = await runSandboxedWorkflow(
            engine,
            fixture,
            'mkdir -p results && cat host-live-edit.txt > results/host-edit-seen.txt',
            {
              whileActive: () => {
                writeFileSync(
                  hostEditPath,
                  'host-written-while-running' + String.fromCharCode(10),
                );
              },
            },
          );
          expectLaunchSucceeded(session);
          expectEngineVolumeLifecycle(session, fixture);
          expect(
            readFileSync(
              join(fixture.repoRoot, 'results', 'host-edit-seen.txt'),
              'utf8',
            ),
          ).toBe('host-written-while-running' + String.fromCharCode(10));
          rmSync(hostEditPath, { force: true });
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertTreeUnchanged(fixture.excludedHostDir, beforeExcluded);
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'runs the complete workflow as arbitrary uid 54321 against realistic dependency modes',
        async () => {
          resetFixtureResults(fixture.repoRoot);
          const session = await runSandboxedWorkflow(
            engine,
            fixture,
            RUN_ONE_SCRIPT,
            { user: '54321:54321' },
          );
          expectLaunchSucceeded(session);
          expectEngineVolumeLifecycle(session, fixture);
          expect(
            readFileSync(
              join(fixture.repoRoot, 'results', 'actual-uid.txt'),
              'utf8',
            ).trim(),
          ).toBe('54321');
          expectResultFile(fixture, 'image-global-ok.txt');
          expectResultFile(fixture, 'install-ok.txt');
          expectResultFile(fixture, 'nested-install-ok.txt');
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          expectResultFile(fixture, 'dependency-modes-ok.txt');
          expectNoBadResultFiles(fixture);
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertTreeUnchanged(fixture.excludedHostDir, beforeExcluded);
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
        },
        SESSION_TIMEOUT_MS,
      );
    },
  );

  // Full CLI relaunch path: the entrypoint starts the image-global llxprt,
  // which drives the same workflow as an agent through fake responses. This
  // engages only when the image's global CLI can actually boot; the
  // registry-published 0.11.0 image cannot (its global install predates this
  // tree and is missing modules), which is outside #3450's scope. Skipping
  // here reports that environment honestly instead of faking an agent
  // session; a locally built image runs the suite.
  // Probe only a selected engine: `engine run --rm <image>` on a usable
  // daemon pulls the image from the registry when it is absent locally,
  // which an excluded engine must never trigger at collection time.
  const imageGlobalBoots =
    ENGINES.includes(engine) && imageGlobalCliBoots(engine, IMAGE);
  describe.skipIf(!ENGINES.includes(engine) || !imageGlobalBoots)(
    `Sandbox node_modules isolation (real ${engine}) image-global agent #3450/#3468`,
    () => {
      let fixture: FixtureWorkspace;
      let home: string;
      let beforeSnapshots: ReadonlyMap<string, TreeEntry>[];
      let beforeExcluded: ReadonlyMap<string, TreeEntry>;
      let beforeAbsent: ReadonlyMap<string, TreeEntry> | undefined;
      let savedStorageEnv: NodeJS.ProcessEnv | undefined;

      beforeAll(() => {
        home = mkdtempSync(join(tmpdir(), `issue3450-${engine}-agent-`));
        fixture = buildFixture(home);
        savedStorageEnv = {
          LLXPRT_CONFIG_HOME: process.env.LLXPRT_CONFIG_HOME,
          LLXPRT_CACHE_HOME: process.env.LLXPRT_CACHE_HOME,
        };
        process.env.LLXPRT_CONFIG_HOME = join(fixture.storageRoot, 'config');
        process.env.LLXPRT_CACHE_HOME = join(fixture.storageRoot, 'cache');
        beforeSnapshots = fixture.protectedHostDirs.map((dir) => {
          const snapshot = snapshotTree(dir);
          if (snapshot === undefined) {
            throw new Error(`protected host dir missing before launch: ${dir}`);
          }
          return snapshot;
        });
        const excludedSnapshot = snapshotTree(fixture.excludedHostDir);
        if (excludedSnapshot === undefined) {
          throw new Error(
            `excluded host dir missing before launch: ${fixture.excludedHostDir}`,
          );
        }
        beforeExcluded = excludedSnapshot;
        beforeAbsent = snapshotTree(fixture.absentProtectedDir);
      });

      afterAll(() => {
        if (savedStorageEnv !== undefined) {
          for (const [key, value] of Object.entries(savedStorageEnv)) {
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        }
        if (home !== undefined && home !== '') {
          if (process.env.ISSUE3450_KEEP !== undefined) return;
          rmSync(home, { recursive: true, force: true });
        }
      });

      it(
        'the image-global agent installs, builds, and tests before host dependencies exist',
        () => {
          const session = runAgentSession(
            engine,
            fixture,
            fixture.responsesRun1,
          );
          expectLaunchSucceeded(session);

          expectResultFile(fixture, 'image-global-ok.txt');
          expectResultFile(fixture, 'install-ok.txt');
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          expectResultFile(fixture, 'host-root-marker-hidden.txt');
          expectResultFile(fixture, 'host-nested-marker-hidden.txt');
          expectResultFile(fixture, 'host-deep-tool-marker-hidden.txt');
          expectResultFile(fixture, 'excluded-marker-visible.txt');
          expectNoBadResultFiles(fixture);

          expect(
            existsSync(join(fixture.repoRoot, 'node_modules', 'private-dep')),
          ).toBe(false);
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertTreeUnchanged(fixture.excludedHostDir, beforeExcluded);
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(beforeAbsent).toBeUndefined();
          expect(
            hostDependencyCacheRoots(join(fixture.storageRoot, 'cache')),
          ).toStrictEqual([]);
        },
        AGENT_SESSION_TIMEOUT_MS,
      );

      it(
        'a second image-global agent run starts with fresh private storage',
        () => {
          const session = runAgentSession(
            engine,
            fixture,
            fixture.responsesRun2,
          );
          expectLaunchSucceeded(session);

          expectResultFile(fixture, 'second-run-fresh.txt');
          expectNoBadResultFiles(fixture);
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertTreeUnchanged(fixture.excludedHostDir, beforeExcluded);
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(
            hostDependencyCacheRoots(join(fixture.storageRoot, 'cache')),
          ).toStrictEqual([]);
        },
        AGENT_SESSION_TIMEOUT_MS,
      );
    },
  );
}

// The fixture creates symlinks and POSIX shell scripts; Windows hosts cannot
// create the symlinks unconditionally.
if (process.platform !== 'win32') {
  describeEngine('docker');
  describeEngine('podman');
}
