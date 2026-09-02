/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-container behavioral test for sandbox Python venv isolation (#3462).
 *
 * The suite drives the PRODUCTION argument-generation path
 * (`buildContainerRunArgs` + `addContainerVolumeMounts` +
 * `addPrivateDependencyMounts` + `addContainerEnvVars` from packages/cli)
 * with an in-workspace `VIRTUAL_ENV` set, and launches a REAL
 * Docker/Podman container with that exact argv. A fixture script inside the
 * container reads `$VIRTUAL_ENV`, creates a venv into it, and runs the venv
 * interpreter, so every assertion is on OBSERVED FILESYSTEM STATE (the
 * in-container venv, the host repository snapshot, leftover engine
 * volumes), never on hand-built mount flags.
 *
 * Covered acceptance criteria:
 *   - AC1/AC3: `$VIRTUAL_ENV` inside the container points at the same
 *     in-container destination as before, is writable by the selected
 *     (arbitrary, non-root) uid, and a real `python3 -m venv` succeeds in
 *     it. The image ships no ensurepip, so the venv is created pip-less and
 *     exercised through its own interpreter.
 *   - AC2: the private venv storage is a per-run engine volume, fresh in
 *     every session (run-one venv content is gone in run two).
 *   - AC4/AC5: the host repository is byte-for-byte unchanged after each
 *     session and `<repo>/.llxprt` (in particular `sandbox.venv`) is never
 *     created, while the container runs or after it exits.
 *
 * Gating (same conventions as sandboxNodeModulesIsolation.real.test.ts):
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
  addContainerEnvVars,
  addContainerVolumeMounts,
  buildContainerRunArgs,
} from '../packages/cli/src/utils/sandbox-containers.js';
import { addPrivateDependencyMounts } from '../packages/cli/src/utils/sandbox-node-modules.js';
import { SANDBOX_DEPENDENCY_RUN_LABEL } from '../packages/cli/src/utils/sandbox-dependency-volumes.js';
import { getContainerPath } from '../packages/cli/src/utils/sandbox-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// One container session on a warm daemon measured well under this; the
// bound exists so a hung runtime fails the test rather than the suite.
const SESSION_TIMEOUT_MS = 180_000;

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

const IMAGE = resolveSandboxImage();
const ENGINES = detectEngines(IMAGE);

// --- fixture ----------------------------------------------------------------

interface FixtureWorkspace {
  /** The repository the sandbox works in (also the container bind). */
  readonly repoRoot: string;
  /** The in-workspace venv path pinned via VIRTUAL_ENV. */
  readonly venvPath: string;
}

function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function resetFixtureResults(repoRoot: string): void {
  const resultsDir = join(repoRoot, 'results');
  rmSync(resultsDir, { recursive: true, force: true });
  mkdirSync(resultsDir, { mode: 0o777 });
  chmodSync(resultsDir, 0o777);
}

/**
 * Builds the fixture repository. `withHostVenv` decides whether the host
 * already carries a venv tree at the destination (the interesting case for
 * byte-for-byte host preservation) or whether the destination is absent
 * before launch (the engine must materialize the mountpoint and the
 * production cleanup must remove it again while it is still empty).
 */
function buildFixture(home: string, withHostVenv: boolean): FixtureWorkspace {
  const repoRoot = join(home, 'repo');

  // Native Linux resolves absolute module paths through this ancestor after
  // Docker bind-mounts /tmp. Keep the fixture private from listing while
  // allowing the deliberately distinct container UID to traverse to the
  // explicitly shared children.
  chmodSync(home, 0o711);
  // The sessions intentionally run as image or mismatched UIDs, so the
  // shared source bind must model a writable workspace rather than
  // inheriting the host test runner's owner-only write permission.
  mkdirSync(repoRoot, { mode: 0o777 });
  chmodSync(repoRoot, 0o777);
  resetFixtureResults(repoRoot);

  writeJsonFile(join(repoRoot, 'package.json'), {
    name: 'issue3462-fixture',
    private: true,
  });

  const venvPath = join(repoRoot, '.venv');
  if (withHostVenv) {
    // A realistic host venv skeleton: a config file, a bin directory, and
    // a dangling-to-the-host symlink. Every byte must survive unchanged.
    mkdirSync(join(venvPath, 'bin'), { recursive: true });
    writeFileSync(join(venvPath, 'pyvenv.cfg'), 'home = /usr/bin\n');
    writeFileSync(
      join(venvPath, 'host-venv-marker.txt'),
      'host-venv-marker-3462\n',
    );
    symlinkSync('/usr/bin/python3', join(venvPath, 'bin', 'python3'));
  }

  return { repoRoot, venvPath };
}

/**
 * The in-container workflow: prove where `$VIRTUAL_ENV` points, that the
 * private storage starts empty (host venv content never reached the
 * container), that the destination is writable by THIS uid (a real pip-less
 * venv creation plus an interpreter run inside it), and record evidence in
 * the shared `results/` directory.
 */
function venvWorkflowScript(containerVenvPath: string): string {
  return [
    'mkdir -p results',
    'id -u > results/actual-uid.txt',
    'printf \'%s\\n\' "$VIRTUAL_ENV" > results/virtual-env-path.txt',
    `if [ "$VIRTUAL_ENV" = '${containerVenvPath}' ]; then echo ok > results/venv-dest-pinned.txt; else printf '%s' "$VIRTUAL_ENV" > results/VENV-DEST-WRONG-BAD.txt; fi`,
    'if [ -z "$(ls -A "$VIRTUAL_ENV")" ]; then echo fresh > results/venv-starts-empty.txt; else ls -A "$VIRTUAL_ENV" > results/VENV-NOT-FRESH-BAD.txt; fi',
    'if [ ! -e "$VIRTUAL_ENV/host-venv-marker.txt" ]; then echo hidden > results/host-venv-hidden.txt; else echo visible > results/HOST-VENV-MARKER-VISIBLE-BAD.txt; fi',
    'stat -c %a "$VIRTUAL_ENV" > results/venv-root-mode.txt',
    // The image ships python3 without ensurepip; the venv is created
    // pip-less and exercised through its own interpreter.
    'python3 -m venv --without-pip "$VIRTUAL_ENV"',
    '"$VIRTUAL_ENV/bin/python3" -c \'import os, sys; sys.exit(0 if sys.prefix == os.environ["VIRTUAL_ENV"] and sys.base_prefix != sys.prefix else 1)\'',
    'echo ok > results/venv-python-ok.txt',
    'printf \'run-venv-marker\\n\' > "$VIRTUAL_ENV/run-venv-marker.txt"',
  ].join('\n');
}

// --- host repository snapshots ----------------------------------------------

interface TreeEntry {
  readonly kind: 'file' | 'dir' | 'symlink';
  readonly content?: string;
  readonly target?: string;
}

/**
 * Snapshots the whole fixture repository except the deliberately shared
 * `results/` directory. Anything the sandbox wrote anywhere else — a
 * recreated venv, a `.llxprt/sandbox.venv`, a materialized mountpoint that
 * outlived the run — changes the snapshot and fails the assertion.
 */
function snapshotRepo(repoRoot: string): ReadonlyMap<string, TreeEntry> {
  const snapshot = new Map<string, TreeEntry>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (dir === repoRoot && entry.name === 'results') continue;
      const fullPath = join(dir, entry.name);
      const rel = fullPath.slice(repoRoot.length + 1);
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
  walk(repoRoot);
  return snapshot;
}

function assertRepoUnchanged(
  repoRoot: string,
  before: ReadonlyMap<string, TreeEntry>,
): void {
  expect(snapshotRepo(repoRoot)).toStrictEqual(before);
}

// --- production-argv workflow launcher --------------------------------------

interface WorkflowSession {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly runId: string;
  readonly labeledVolumesWhileActive: readonly string[];
  readonly mountedVolumeNames: readonly string[];
  readonly mountedDestinations: readonly string[];
  readonly labeledVolumesAfterRelease: readonly string[];
  readonly venvMountAfterWorkspaceBind: boolean;
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

function queryRunVolumes(engine: string, runId: string): string[] {
  const filter = `label=${SANDBOX_DEPENDENCY_RUN_LABEL}=${runId}`;
  const result = spawnSync(
    engine,
    ['volume', 'ls', '--filter', filter, '--format', '{{.Name}}'],
    {
      encoding: 'utf8',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(
      `Failed to query ${engine} volumes for run ID '${runId}' ` +
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

interface LaunchResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Builds the production container argv in production order (workspace bind
 * and pinned env through `buildContainerRunArgs`/`addContainerEnvVars`,
 * private engine volumes appended after the workspace bind through
 * `addPrivateDependencyMounts`), observes the labeled engine volumes while
 * the named main container is alive, then runs the venv workflow and
 * releases the production lifecycle.
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
  const containerName = `issue3462-${engine}-${randomUUID()}`;
  addContainerEnvVars(args, config, containerName, [], fixture.repoRoot);
  if (options.user === undefined) {
    addNativeLinuxHostUser(args);
  } else {
    args.push('--user', options.user);
  }
  args.push('--name', containerName);
  lifecycle.recordMainContainerName(containerName);

  const runId = labelValue(args, SANDBOX_DEPENDENCY_RUN_LABEL);
  const workspaceBindOperand = `${fixture.repoRoot}:${containerWorkdir}`;
  const mounts = flagValues(args, '--mount');
  const mountedVolumeNames = mounts.map((mount) => mountField(mount, 'src'));
  const mountedDestinations = mounts.map((mount) => mountField(mount, 'dst'));
  const containerVenvPath = getContainerPath(fixture.venvPath);
  const venvMountIndex = mounts.findIndex(
    (mount) => mountField(mount, 'dst') === containerVenvPath,
  );
  const workspaceBindIndex = args.indexOf(workspaceBindOperand);
  if (workspaceBindIndex === -1) {
    throw new Error('workspace bind missing from the production argv');
  }
  const venvMountArgIndex =
    venvMountIndex === -1 ? -1 : args.indexOf(mounts[venvMountIndex]);
  const venvMountAfterWorkspaceBind =
    venvMountArgIndex !== -1 && venvMountArgIndex > workspaceBindIndex;

  const readinessMarker = `issue3462-ready-${randomUUID()}`;
  const wrappedScript = [
    `printf '${readinessMarker}\\n'`,
    'read issue3462_release',
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
    venvMountAfterWorkspaceBind,
  };
}

// --- shared session assertions ----------------------------------------------

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
  expectedHostDestinations: readonly string[],
): void {
  const expectedDestinations = expectedHostDestinations.map(getContainerPath);
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
  // The engine-owned venv volume must shadow the host venv through the
  // workspace bind (a nested mount appended after it wins).
  expect(session.venvMountAfterWorkspaceBind).toBe(true);
  expect(session.labeledVolumesAfterRelease).toStrictEqual([]);
}

function expectResultFile(repoRoot: string, name: string): void {
  expect(existsSync(join(repoRoot, 'results', name))).toBe(true);
}

function expectNoBadResultFiles(repoRoot: string): void {
  const resultsDir = join(repoRoot, 'results');
  if (!existsSync(resultsDir)) {
    return;
  }
  const bad = readdirSync(resultsDir).filter((name) =>
    name.endsWith('-BAD.txt'),
  );
  expect(bad).toStrictEqual([]);
}

/**
 * AC4/AC5: the version-controlled settings directory is never created, and
 * in particular `sandbox.venv` never appears under it.
 */
function expectNoSandboxVenvInSettingsDirectory(repoRoot: string): void {
  expect(existsSync(join(repoRoot, '.llxprt'))).toBe(false);
  expect(existsSync(join(repoRoot, '.llxprt', 'sandbox.venv'))).toBe(false);
}

function expectVenvWorkflowResults(
  fixture: FixtureWorkspace,
  expectedUid: string | undefined,
): void {
  const actualUid = readFileSync(
    join(fixture.repoRoot, 'results', 'actual-uid.txt'),
    'utf8',
  ).trim();
  // The private venv storage must be usable by a non-root container user;
  // the arbitrary-uid session pins the exact value.
  expect(actualUid).not.toBe('0');
  if (expectedUid !== undefined) {
    expect(actualUid).toBe(expectedUid);
  }
  expect(
    readFileSync(
      join(fixture.repoRoot, 'results', 'virtual-env-path.txt'),
      'utf8',
    ).trim(),
  ).toBe(getContainerPath(fixture.venvPath));
  expectResultFile(fixture.repoRoot, 'venv-dest-pinned.txt');
  expectResultFile(fixture.repoRoot, 'venv-starts-empty.txt');
  expectResultFile(fixture.repoRoot, 'host-venv-hidden.txt');
  expectResultFile(fixture.repoRoot, 'venv-python-ok.txt');
  expect(
    readFileSync(
      join(fixture.repoRoot, 'results', 'venv-root-mode.txt'),
      'utf8',
    ).trim(),
  ).toBe('1777');
  expectNoBadResultFiles(fixture.repoRoot);
}

// --- the real-engine suites ---------------------------------------------------

function describeEngine(engine: string): void {
  describe.skipIf(!ENGINES.includes(engine))(
    `Sandbox venv isolation (real ${engine}) #3462`,
    () => {
      let fixture: FixtureWorkspace;
      let home: string;
      let beforeSnapshot: ReadonlyMap<string, TreeEntry>;
      let savedVirtualEnv: string | undefined;

      beforeAll(() => {
        home = mkdtempSync(join(tmpdir(), `issue3462-${engine}-`));
        fixture = buildFixture(home, true);
        savedVirtualEnv = process.env.VIRTUAL_ENV;
        process.env.VIRTUAL_ENV = fixture.venvPath;
        beforeSnapshot = snapshotRepo(fixture.repoRoot);
      });

      afterAll(() => {
        if (savedVirtualEnv === undefined) {
          delete process.env.VIRTUAL_ENV;
        } else {
          process.env.VIRTUAL_ENV = savedVirtualEnv;
        }
        if (home !== undefined && home !== '') {
          if (process.env.ISSUE3462_KEEP !== undefined) return;
          rmSync(home, { recursive: true, force: true });
        }
      });

      it(
        'one sandbox session gets a private writable venv while the host repository stays unchanged',
        async () => {
          const session = await runSandboxedWorkflow(
            engine,
            fixture,
            venvWorkflowScript(getContainerPath(fixture.venvPath)),
            {
              whileActive: () => {
                // While the sandbox runs, nothing may appear under the
                // repository's version-controlled settings directory.
                expectNoSandboxVenvInSettingsDirectory(fixture.repoRoot);
              },
            },
          );
          expectLaunchSucceeded(session);
          expectEngineVolumeLifecycle(session, [
            join(fixture.repoRoot, 'node_modules'),
            fixture.venvPath,
          ]);
          expectVenvWorkflowResults(fixture, undefined);
          // AC5: byte-for-byte host repository preservation.
          assertRepoUnchanged(fixture.repoRoot, beforeSnapshot);
          expectNoSandboxVenvInSettingsDirectory(fixture.repoRoot);
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'a second run as arbitrary uid 54321 starts with a fresh private venv',
        async () => {
          resetFixtureResults(fixture.repoRoot);
          const session = await runSandboxedWorkflow(
            engine,
            fixture,
            [
              'rm -rf results/*',
              venvWorkflowScript(getContainerPath(fixture.venvPath)),
            ].join('\n'),
            { user: '54321:54321' },
          );
          expectLaunchSucceeded(session);
          expectEngineVolumeLifecycle(session, [
            join(fixture.repoRoot, 'node_modules'),
            fixture.venvPath,
          ]);
          expectVenvWorkflowResults(fixture, '54321');
          assertRepoUnchanged(fixture.repoRoot, beforeSnapshot);
          expectNoSandboxVenvInSettingsDirectory(fixture.repoRoot);
        },
        SESSION_TIMEOUT_MS,
      );
    },
  );

  describe.skipIf(!ENGINES.includes(engine))(
    `Sandbox venv absent destination (real ${engine}) #3462`,
    () => {
      it(
        'an absent venv destination is materialized for the run and removed after release',
        async () => {
          const home = mkdtempSync(
            join(tmpdir(), `issue3462-${engine}-absent-`),
          );
          const fixture = buildFixture(home, false);
          const savedVirtualEnv = process.env.VIRTUAL_ENV;
          process.env.VIRTUAL_ENV = fixture.venvPath;
          try {
            expect(existsSync(fixture.venvPath)).toBe(false);
            const beforeSnapshot = snapshotRepo(fixture.repoRoot);
            const session = await runSandboxedWorkflow(
              engine,
              fixture,
              venvWorkflowScript(getContainerPath(fixture.venvPath)),
            );
            expectLaunchSucceeded(session);
            expectEngineVolumeLifecycle(session, [
              join(fixture.repoRoot, 'node_modules'),
              fixture.venvPath,
            ]);
            expectVenvWorkflowResults(fixture, undefined);
            // The engine materialized the mountpoint only for the run; the
            // still-empty host directory is gone again after release, and
            // everything else in the repository is byte-for-byte unchanged.
            assertRepoUnchanged(fixture.repoRoot, beforeSnapshot);
            expectNoSandboxVenvInSettingsDirectory(fixture.repoRoot);
          } finally {
            if (savedVirtualEnv === undefined) {
              delete process.env.VIRTUAL_ENV;
            } else {
              process.env.VIRTUAL_ENV = savedVirtualEnv;
            }
            if (process.env.ISSUE3462_KEEP === undefined) {
              rmSync(home, { recursive: true, force: true });
            }
          }
        },
        SESSION_TIMEOUT_MS,
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
