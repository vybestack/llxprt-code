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
 * test commands — the issue's exact workflow — so every assertion is on
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
const RUN_ROOT_PREFIX = 'sandbox-node-modules-';

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

function buildFixture(home: string): FixtureWorkspace {
  const repoRoot = join(home, 'repo');
  const storageRoot = join(home, 'storage');

  writeJsonFile(join(repoRoot, 'package.json'), {
    name: 'issue3450-fixture',
    private: true,
    workspaces: ['packages/nested', 'packages/absent'],
  });
  writeJsonFile(join(repoRoot, 'packages', 'nested', 'package.json'), {
    name: 'issue3450-nested',
    private: true,
  });
  // Declared but not created: its node_modules must stay absent on the host.
  writeJsonFile(join(repoRoot, 'packages', 'absent', 'package.json'), {
    name: 'issue3450-absent',
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

  // The fixture's offline installer, build, and test commands. Every claim is
  // recorded as a distinct result file so the host test can attribute each
  // observed outcome to one in-container command.
  writeScript(
    join(repoRoot, 'env-check.sh'),
    [
      'mkdir -p results',
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
      'if [ ! -e node_modules/host-root-marker.txt ]; then echo hidden > results/host-root-marker-hidden.txt; else echo visible > results/HOST-ROOT-MARKER-VISIBLE-BAD.txt; fi',
      'if [ ! -e packages/nested/node_modules/host-nested-marker.txt ]; then echo hidden > results/host-nested-marker-hidden.txt; else echo visible > results/HOST-NESTED-MARKER-VISIBLE-BAD.txt; fi',
    ].join('\n'),
  );
  writeScript(
    join(repoRoot, 'build.sh'),
    [
      'node -e \'const d = require("./node_modules/private-dep/answer.js"); require("fs").writeFileSync("results/build-ok.txt", "answer=" + d.answer)\'',
      // The later build consumes the nested private dependency the same
      // installer run wrote: persistence within one session.
      'node -e \'const d = require("./packages/nested/node_modules/nested-private-dep/answer.js"); require("fs").appendFileSync("results/build-ok.txt", " nested-answer=" + d.answer)\'',
    ].join('\n'),
  );
  writeScript(
    join(repoRoot, 'test.sh'),
    [
      'grep -q "answer=42" results/build-ok.txt',
      'grep -q "nested-answer=42" results/build-ok.txt',
      'echo tests-passed > results/test-ok.txt',
    ].join('\n'),
  );
  writeScript(
    join(repoRoot, 'fresh-check.sh'),
    [
      'mkdir -p results',
      'if [ ! -e node_modules/run1-private-marker.txt ] && [ ! -e packages/nested/node_modules/nested-run1-private-marker.txt ]; then echo fresh > results/second-run-fresh.txt; else echo stale > results/SECOND-RUN-STALE-BAD.txt; fi',
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
    ],
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

function privateRunRoots(cacheDir: string): string[] {
  if (!existsSync(cacheDir)) {
    return [];
  }
  return readdirSync(cacheDir)
    .filter((entry) => entry.startsWith(RUN_ROOT_PREFIX))
    .map((entry) => join(cacheDir, entry));
}

// --- production-argv workflow launcher --------------------------------------

interface WorkflowSession {
  /** Exit status of the container command (null on timeout/signal). */
  readonly status: number | null;
  /** Private per-run storage roots that existed BEFORE cleanup ran. */
  readonly runRootsBeforeCleanup: readonly string[];
}

/**
 * Builds the PRODUCTION container argv (same functions, same order, as
 * prepareContainerImageAndArgs in sandbox-exec.ts), runs one container
 * session executing `innerScript`, then performs the production cleanup and
 * reports what the launch created.
 */
function runSandboxedWorkflow(
  engine: string,
  fixture: FixtureWorkspace,
  innerScript: string,
): WorkflowSession {
  const config = { command: engine, image: IMAGE };
  const containerWorkdir = getContainerPath(fixture.repoRoot);
  const args = buildContainerRunArgs(
    config,
    IMAGE,
    fixture.repoRoot,
    containerWorkdir,
    realpathSync(tmpdir()),
  );
  // The real launch runs attached to the user's terminal; this harness runs
  // non-interactive, where docker rejects -t. Drop only the TTY allocation —
  // every mount and hardening flag stays exactly as produced.
  const ttyIndex = args.indexOf('-t');
  if (ttyIndex !== -1) args.splice(ttyIndex, 1);
  addContainerVolumeMounts(args);
  const cleanup = addPrivateDependencyMounts(config, args, fixture.repoRoot);
  const runRoots = privateRunRoots(join(fixture.storageRoot, 'cache'));
  let status: number | null = null;
  let stderr = '';
  try {
    const result = spawnSync(
      engine,
      [...args, IMAGE, 'sh', '-c', innerScript],
      {
        cwd: fixture.repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: SESSION_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    status = result.status;
    stderr = result.stderr ?? '';
    if (result.error !== undefined) {
      status = null;
      stderr += String(result.error);
    }
  } finally {
    if (stderr !== '') {
      writeTextFile(
        join(fixture.storageRoot, 'last-workflow-stderr.log'),
        stderr,
      );
    }
    cleanup();
  }
  return { status, runRootsBeforeCleanup: runRoots };
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

// --- gated image-global agent launcher ---------------------------------------

interface SessionResult {
  readonly status: number | null;
  readonly stderr: string;
}

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
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
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
    stderr: (result.stderr ?? '') + (result.stdout ?? ''),
  };
}

// --- the real-engine suites ---------------------------------------------------

function describeEngine(engine: string): void {
  describe.skipIf(!ENGINES.includes(engine))(
    `Sandbox node_modules isolation (real ${engine}) #3450`,
    () => {
      let fixture: FixtureWorkspace;
      let home: string;
      let beforeSnapshots: ReadonlyMap<string, TreeEntry>[];
      let beforeAbsent: ReadonlyMap<string, TreeEntry> | undefined;
      let savedStorageEnv: NodeJS.ProcessEnv;

      beforeAll(() => {
        home = mkdtempSync(join(tmpdir(), `issue3450-${engine}-`));
        fixture = buildFixture(home);
        // Point the PRODUCTION Storage resolver at the fixture's isolated
        // cache/config roots so the private per-run storage lands there and
        // can be asserted after exit, without touching the real user cache.
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
        beforeAbsent = snapshotTree(fixture.absentProtectedDir);
      });

      afterAll(() => {
        for (const [key, value] of Object.entries(savedStorageEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
        if (home !== undefined && home !== '') {
          if (process.env.ISSUE3450_KEEP !== undefined) return;
          rmSync(home, { recursive: true, force: true });
        }
      });

      it(
        'one sandbox session installs, builds, and tests against private dependencies',
        () => {
          const session = runSandboxedWorkflow(engine, fixture, RUN_ONE_SCRIPT);
          expect(session.status).toBe(0);

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
          ).toBe('answer=42 nested-answer=42');
          // Host dependency trees were hidden inside the container.
          expectResultFile(fixture, 'host-root-marker-hidden.txt');
          expectResultFile(fixture, 'host-nested-marker-hidden.txt');
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
          // A protected host path that was absent before launch gained
          // nothing from the session.
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(beforeAbsent).toBeUndefined();

          // The launch created exactly one private per-run subtree under the
          // LLxprt cache root, and the production cleanup removed it.
          expect(session.runRootsBeforeCleanup).toHaveLength(1);
          expect(
            privateRunRoots(join(fixture.storageRoot, 'cache')),
          ).toStrictEqual([]);
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'a second run starts with fresh private dependency storage',
        () => {
          const session = runSandboxedWorkflow(engine, fixture, RUN_TWO_SCRIPT);
          expect(session.status).toBe(0);

          expectResultFile(fixture, 'second-run-fresh.txt');
          expectNoBadResultFiles(fixture);

          // The second run repeated the full workflow against its own private
          // dependencies and still left the host trees untouched.
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(session.runRootsBeforeCleanup).toHaveLength(1);
          expect(
            privateRunRoots(join(fixture.storageRoot, 'cache')),
          ).toStrictEqual([]);
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'shows host source edits inside the running container',
        async () => {
          // Production argv, async launch: the container polls for a source
          // file that the HOST writes while the container is running, then
          // reads it back. Proves the shared source bind is live in both
          // directions during a session, not only at launch.
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
          const cleanup = addPrivateDependencyMounts(
            config,
            args,
            fixture.repoRoot,
          );
          const innerScript = [
            'i=0',
            'while [ ! -f host-live-edit.txt ] && [ "$i" -lt 300 ]; do sleep 0.2; i=$((i+1)); done',
            'mkdir -p results',
            'cat host-live-edit.txt > results/host-edit-seen.txt',
          ].join(String.fromCharCode(10));
          const child = spawn(
            engine,
            [...args, IMAGE, 'sh', '-c', innerScript],
            {
              cwd: fixture.repoRoot,
              stdio: 'ignore',
            },
          );
          const hostEditPath = join(fixture.repoRoot, 'host-live-edit.txt');
          const writeHostEdit = setTimeout(() => {
            writeFileSync(
              hostEditPath,
              'host-written-while-running' + String.fromCharCode(10),
            );
          }, 750);
          let closeStatus: number | null = null;
          let closeError: string | null = null;
          let raceTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            const closed = new Promise<void>((resolve) => {
              child.on('close', (code) => {
                closeStatus = code;
                resolve();
              });
              child.on('error', (err) => {
                closeError = String(err);
                resolve();
              });
            });
            const timedOut = new Promise<void>((resolve) => {
              raceTimer = setTimeout(resolve, SESSION_TIMEOUT_MS);
            });
            await Promise.race([closed, timedOut]);
          } finally {
            clearTimeout(writeHostEdit);
            clearTimeout(raceTimer);
            cleanup();
          }
          expect(closeError).toBeNull();
          expect(closeStatus).toBe(0);
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
          expect(
            privateRunRoots(join(fixture.storageRoot, 'cache')),
          ).toStrictEqual([]);
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'accepts mismatched-container-UID writes into the private dependency mounts',
        () => {
          // The private bind children are mode 0777 precisely so the
          // already-selected main-container user can write them even when
          // its UID differs from the host owner. Run the production argv
          // with an arbitrary mismatched UID and execute the installer
          // workflow end to end (root and nested trees).
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
          const cleanup = addPrivateDependencyMounts(
            config,
            args,
            fixture.repoRoot,
          );
          // Select the main-container user explicitly as a UID that cannot
          // match the host owner of the cache-resident private directories.
          args.push('--user', '54321:54321');
          let status: number | null = null;
          try {
            const result = spawnSync(
              engine,
              [
                ...args,
                IMAGE,
                'sh',
                '-c',
                './install.sh && ./build.sh && ./test.sh',
              ],
              {
                cwd: fixture.repoRoot,
                stdio: ['ignore', 'pipe', 'pipe'],
                encoding: 'utf8',
                timeout: SESSION_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
              },
            );
            status = result.status;
            if (status !== 0) {
              writeTextFile(
                join(fixture.storageRoot, 'uid-mismatch-stderr.log'),
                result.stderr ?? '',
              );
            }
          } finally {
            cleanup();
          }
          expect(status).toBe(0);
          expectResultFile(fixture, 'install-ok.txt');
          expectResultFile(fixture, 'nested-install-ok.txt');
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          expectNoBadResultFiles(fixture);
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(
            privateRunRoots(join(fixture.storageRoot, 'cache')),
          ).toStrictEqual([]);
        },
        SESSION_TIMEOUT_MS,
      );

      it(
        'enforces uid-mismatch write semantics on real Linux engine storage (0755 denies, 0777 allows)',
        () => {
          // On this macOS host, host-backed binds cross virtiofs, which does
          // NOT enforce mode bits (probe evidence: a 0755 root-owned host
          // bind accepted writes from --user 54321 on BOTH engines), so the
          // denial cannot be shown through the workspace bind here. The
          // private-directory mode matters exactly where the engine stores
          // state on real Linux filesystems, so prove the semantics there:
          //   - Docker: named volumes live on the VM's real ext4; a root
          //     -owned 0755 volume denies a mismatched UID, 0777 allows it.
          //   - Podman (macOS rootless machine): named volumes are idmapped
          //     (appear owned by the container uid, no denial), so the
          //     enforced path is a root-owned tmpfs with an unprivileged su.
          const probe = (
            runArgs: string[],
          ): { status: number | null; stderr: string } => {
            const result = spawnSync(engine, runArgs, {
              stdio: ['ignore', 'pipe', 'pipe'],
              encoding: 'utf8',
              timeout: SESSION_TIMEOUT_MS,
              maxBuffer: 10 * 1024 * 1024,
            });
            return { status: result.status, stderr: result.stderr ?? '' };
          };
          if (engine === 'docker') {
            const suffix = randomUUID().slice(0, 8);
            const vol755 = `issue3450-uid-755-${suffix}`;
            const vol777 = `issue3450-uid-777-${suffix}`;
            try {
              for (const volume of [vol755, vol777]) {
                execFileSync(engine, ['volume', 'create', volume], {
                  timeout: 60_000,
                });
                execFileSync(
                  engine,
                  [
                    'run',
                    '--rm',
                    '--user',
                    '0:0',
                    '-v',
                    `${volume}:/p`,
                    IMAGE,
                    'chmod',
                    volume === vol755 ? '0755' : '0777',
                    '/p',
                  ],
                  { timeout: SESSION_TIMEOUT_MS },
                );
              }
              const denied = probe([
                'run',
                '--rm',
                '--user',
                '54321:54321',
                '-v',
                `${vol755}:/p`,
                IMAGE,
                'sh',
                '-c',
                'touch /p/f',
              ]);
              expect(denied.status).not.toBe(0);
              expect(denied.stderr).toContain('Permission denied');
              const allowed = probe([
                'run',
                '--rm',
                '--user',
                '54321:54321',
                '-v',
                `${vol777}:/p`,
                IMAGE,
                'sh',
                '-c',
                'touch /p/f',
              ]);
              expect(allowed.status).toBe(0);
            } finally {
              for (const volume of [vol755, vol777]) {
                spawnSync(engine, ['volume', 'rm', '-f', volume], {
                  timeout: 60_000,
                });
              }
            }
          } else {
            const denied = probe([
              'run',
              '--rm',
              '--user',
              '0:0',
              '--tmpfs',
              '/p:mode=0755',
              IMAGE,
              'su',
              '-s',
              '/bin/sh',
              'nobody',
              '-c',
              'touch /p/f',
            ]);
            expect(denied.status).not.toBe(0);
            const allowed = probe([
              'run',
              '--rm',
              '--user',
              '0:0',
              '--tmpfs',
              '/p:mode=0777',
              IMAGE,
              'su',
              '-s',
              '/bin/sh',
              'nobody',
              '-c',
              'touch /p/f',
            ]);
            expect(allowed.status).toBe(0);
          }
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
    `Sandbox node_modules isolation (real ${engine}) image-global agent #3450`,
    () => {
      let fixture: FixtureWorkspace;
      let home: string;
      let beforeSnapshots: ReadonlyMap<string, TreeEntry>[];
      let beforeAbsent: ReadonlyMap<string, TreeEntry> | undefined;
      let savedStorageEnv: NodeJS.ProcessEnv;

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
        beforeAbsent = snapshotTree(fixture.absentProtectedDir);
      });

      afterAll(() => {
        for (const [key, value] of Object.entries(savedStorageEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
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
          expect(session.status).toBe(0);

          expectResultFile(fixture, 'image-global-ok.txt');
          expectResultFile(fixture, 'install-ok.txt');
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          expectResultFile(fixture, 'host-root-marker-hidden.txt');
          expectResultFile(fixture, 'host-nested-marker-hidden.txt');
          expectNoBadResultFiles(fixture);

          expect(
            existsSync(join(fixture.repoRoot, 'node_modules', 'private-dep')),
          ).toBe(false);
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(beforeAbsent).toBeUndefined();
          expect(
            privateRunRoots(join(fixture.storageRoot, 'cache')),
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
          expect(session.status).toBe(0);

          expectResultFile(fixture, 'second-run-fresh.txt');
          expectNoBadResultFiles(fixture);
          expectResultFile(fixture, 'build-ok.txt');
          expectResultFile(fixture, 'test-ok.txt');
          fixture.protectedHostDirs.forEach((dir, i) => {
            assertTreeUnchanged(dir, beforeSnapshots[i]);
          });
          assertAbsentProtectedPathStrictlyGone(fixture.absentProtectedDir);
          expect(
            privateRunRoots(join(fixture.storageRoot, 'cache')),
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
