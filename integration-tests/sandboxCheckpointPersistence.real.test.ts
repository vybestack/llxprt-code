#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-container behavioral test for persistent sandbox checkpoint storage
 * (#3464).
 *
 * The engine suites drive the PRODUCTION argument-generation path
 * (`buildContainerRunArgs` + `attachPersistentCheckpointStore` from
 * packages/cli; the attach genuinely creates the engine volume and runs the
 * hardened init container) and launch REAL Docker/Podman containers whose
 * shell prologue is the EXACT production entrypoint text (`XDG_HOME_PIN_STANZA`
 * + `buildCheckpointEntrypointScript`). Inside the containers, the scripts
 * drive the real `git` binary through the exact GIT_DIR/GIT_WORK_TREE/HOME
 * topology GitService uses, so every assertion observes produced filesystem
 * state: snapshot commits, restored workspace contents, checkpoint metadata
 * JSONs, engine volume labels, and the absence of checkpoint state anywhere
 * on the host outside the engine-owned store.
 *
 * Suites:
 *   1. create → exit (`--rm`) → volume survives with labels → restart (a
 *      fresh attach + fresh container) → history still readable → new
 *      snapshot → restore of the run-one commit reverts the workspace.
 *   2. arbitrary selected uid 54321 reads prior objects, commits, and
 *      restores, proving cross-uid sharing on the same store.
 *   3. #3450 coexistence: dependency volumes are released by their run
 *      lifecycle while the checkpoint store and its history stay intact.
 *   4. version skew (gated on the image containing #3464's in-container
 *      fail-fast): an old launcher shape (no store) makes the in-container
 *      CLI exit nonzero with the persistence error instead of presenting an
 *      ineffective feature.
 *   5. gated image-global CLI suites: full `--sandbox --checkpointing`
 *      relaunch sessions through the real CLI; the second session reuses the
 *      same store (HEAD and probe state stable across sessions).
 *
 * Gating (same conventions as sandboxNodeModulesIsolation.real.test.ts):
 *   - RUNS whenever each engine is usable and the sandbox image is present
 *     locally; SKIPS only when they genuinely are not.
 *   - Runtime selection honors `LLXPRT_SANDBOX=docker|podman` (set by the
 *     npm scripts) and `LLXPRT_SANDBOX_TEST_RUNTIME=<runtime>`.
 *   - Override the image with `LLXPRT_SANDBOX_TEST_IMAGE=<ref>`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { buildContainerRunArgs } from '../packages/cli/src/utils/sandbox-containers.js';
import type { SandboxConfig } from '../packages/core/src/config/configTypes.js';
import { XDG_HOME_PIN_STANZA } from '../packages/cli/src/utils/sandbox-entrypoint.js';
import {
  planCheckpointStorage,
  attachPersistentCheckpointStore,
  buildCheckpointEntrypointScript,
  CHECKPOINT_VOLUME_NAME_PREFIX,
  CHECKPOINT_STORE_MOUNT_PATH,
  SANDBOX_CHECKPOINT_STORE_LABEL,
  SANDBOX_CHECKPOINT_PERSISTENT_LABEL,
  CHECKPOINT_STORE_MARKER_FILENAME,
} from '../packages/cli/src/utils/sandbox-checkpoint-storage.js';
import { addPrivateDependencyMounts } from '../packages/cli/src/utils/sandbox-node-modules.js';
import { SANDBOX_DEPENDENCY_RUN_LABEL } from '../packages/cli/src/utils/sandbox-dependency-volumes.js';
import { getContainerPath } from '../packages/cli/src/utils/sandbox-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'cli', 'index.ts');

// Warm-daemon sessions measured well under these bounds; they exist so a
// hung runtime fails the test rather than the suite.
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

/**
 * Probes whether the image's in-container CLI contains #3464's
 * persistence fail-fast (the marker-filename contract compiled into the
 * bundle). The registry image predating this tree reports its state plainly
 * and skips the version-skew suite; a locally built image
 * (`npm run build:sandbox`) runs it.
 */
function imageHasCheckpointFailFast(engine: string, image: string): boolean {
  try {
    execFileSync(
      engine,
      [
        'run',
        '--rm',
        image,
        'sh',
        '-c',
        `grep -rq ${CHECKPOINT_STORE_MARKER_FILENAME} /usr/local/share/npm-global/lib/node_modules/ 2>/dev/null`,
      ],
      { stdio: 'ignore', timeout: 120_000 },
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
  /** The git workspace the sandbox works in (also the container bind). */
  readonly repoRoot: string;
  /** Isolated LLxprt config/data/cache/log roots for the test process. */
  readonly storageRoot: string;
  /** Responses file for the gated agent-driven suites. */
  readonly responses: string;
}

function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function snapshotTree(root: string): ReadonlyMap<string, string> | undefined {
  if (!existsSync(root)) {
    return undefined;
  }
  const snapshot = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const rel = fullPath.slice(root.length + 1);
      if (entry.isDirectory()) {
        snapshot.set(rel, 'dir');
        walk(fullPath);
      } else {
        snapshot.set(rel, readFileSync(fullPath, 'utf8'));
      }
    }
  };
  walk(root);
  return snapshot;
}

function buildFixture(home: string): FixtureWorkspace {
  const repoRoot = join(home, 'repo');
  const storageRoot = join(home, 'storage');

  // Native Linux resolves absolute module paths through this ancestor after
  // Docker bind-mounts /tmp; keep the fixture private from listing while
  // allowing container users to traverse to the shared workspace.
  chmodSync(home, 0o711);
  // The sessions run as the image user or a deliberately distinct uid, so
  // the shared workspace bind must be writable rather than inheriting the
  // host test runner's owner-only write permission.
  mkdirSync(repoRoot, { mode: 0o777 });
  chmodSync(repoRoot, 0o777);

  // A real git workspace modeling production projects: root .gitignore,
  // nested .gitignore, repository-local exclude rules. `results/` stays
  // ignored so session output files are never part of (or removed by)
  // snapshot restore operations.
  execFileSync('git', ['init', '--initial-branch=main', repoRoot]);
  writeTextFile(join(repoRoot, '.gitignore'), 'root-ignored.txt\n/results/\n');
  writeTextFile(
    join(repoRoot, '.git', 'info', 'exclude'),
    'secret-local.txt\n',
  );
  writeTextFile(join(repoRoot, 'nested', '.gitignore'), 'nested-ignored.txt\n');
  writeTextFile(join(repoRoot, 'tracked.txt'), 'run-one v1\n');
  writeTextFile(join(repoRoot, 'root-ignored.txt'), 'ignored\n');
  writeTextFile(join(repoRoot, 'secret-local.txt'), 'ignored\n');
  writeTextFile(join(repoRoot, 'nested', 'nested-ignored.txt'), 'ignored\n');
  writeTextFile(
    join(repoRoot, 'nested', 'nested-tracked.txt'),
    'nested tracked v1\n',
  );
  // A protected dependency tree for the #3450 coexistence session.
  writeTextFile(
    join(repoRoot, 'node_modules', 'host-root-marker.txt'),
    'host-root-marker-3464\n',
  );
  mkdirSync(join(repoRoot, 'results'), { mode: 0o777 });
  chmodSync(join(repoRoot, 'results'), 0o777);
  // World-writable for the arbitrary-uid session writes (and clean).
  execFileSync('chmod', ['-R', 'a+rwX', repoRoot]);

  // Deterministic single-turn responses for the gated agent-driven suites.
  const responses = join(repoRoot, 'fake-responses.jsonl');
  writeFileSync(
    responses,
    JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: 'issue3464 checkpoint session complete',
            },
          ],
          metadata: {
            usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
          },
        },
      ],
    }) + '\n',
  );

  for (const dir of ['config', 'data', 'cache', 'log']) {
    mkdirSync(join(storageRoot, dir), { recursive: true });
  }

  return { repoRoot, storageRoot, responses };
}

// --- in-container session scripts -------------------------------------------

/**
 * The bash prologue production composes inside the entrypoint: pin the
 * data/cache/log homes to the real container home, then link the checkpoint
 * history and metadata directories into the persistent store (failing the
 * sandbox when the store is not mounted).
 */
const CHECKPOINT_PROLOGUE = [
  XDG_HOME_PIN_STANZA,
  buildCheckpointEntrypointScript(),
].join('\n');

/**
 * Models GitService's exact shadow-repository mechanics with the real git
 * binary: the .gitconfig content, repo init + initial empty commit with the
 * shadow HOME pinning, root .gitignore copy, exclude sync before every
 * snapshot, snapshot commits, and restore.
 */
const SHADOW_GIT_HELPERS = [
  'WS="$PWD"',
  'KEY="$LLXPRT_SANDBOX_PROJECT_KEY"',
  'HIST="$LLXPRT_DATA_HOME/history/$KEY"',
  'CKPT="$LLXPRT_LOG_HOME/tmp/$KEY/checkpoints"',
  'hist_env() {',
  '  export GIT_DIR="$HIST/.git" GIT_WORK_TREE="$WS" HOME="$HIST" XDG_CONFIG_HOME="$HIST"',
  '}',
  'hist_setup() {',
  '  mkdir -p "$HIST"',
  "  printf '%s\\n' '[user]' '  name = llxprt-code' '  email = llxprt-code-bot@users.noreply.github.com' '[commit]' '  gpgsign = false' '[safe]' '  directory = *' > \"$HIST/.gitconfig\"",
  '  if [ ! -d "$HIST/.git" ]; then',
  '    ( export HOME="$HIST" XDG_CONFIG_HOME="$HIST"',
  '      cd "$HIST" && git init --initial-branch=main . >/dev/null \\',
  "        && git commit --allow-empty -m 'Initial commit' >/dev/null )",
  '  fi',
  '  cat "$WS/.gitignore" > "$HIST/.gitignore" 2>/dev/null || : > "$HIST/.gitignore"',
  '  hist_sync_exclude',
  '}',
  'hist_sync_exclude() {',
  '  mkdir -p "$HIST/.git/info"',
  '  cat "$WS/.git/info/exclude" > "$HIST/.git/info/exclude" 2>/dev/null \\',
  '    || : > "$HIST/.git/info/exclude"',
  '}',
  'hist_snapshot() {',
  '  hist_sync_exclude',
  '  hist_env',
  '  git add . >/dev/null',
  '  git commit --no-verify -m "$1" >/dev/null',
  '  git rev-parse HEAD',
  '}',
  'hist_restore() {',
  '  hist_env',
  '  git restore --source="$1" .',
  '  git clean -f -d',
  '}',
  'write_checkpoint() {',
  '  mkdir -p "$CKPT"',
  '  printf \'{"commitHash":"%s"}\\n\' "$2" > "$CKPT/$1"',
  '}',
].join('\n');

const RUN_ONE_SCRIPT = [
  'set -eu',
  SHADOW_GIT_HELPERS,
  'mkdir -p results',
  'hist_setup',
  'H1=$(hist_snapshot "run one snapshot")',
  'write_checkpoint run-one.json "$H1"',
  'printf "%s" "$H1" > results/run1-head.txt',
  // Ignore semantics observed through the real snapshot tree, exactly as
  // the shadow repository sees the workspace on this engine.
  'hist_env',
  'TREE=$(git ls-tree -r --name-only HEAD)',
  'echo "$TREE" | grep -qx "tracked.txt" && echo tree-tracked-ok',
  'echo "$TREE" | grep -qx "nested/nested-tracked.txt" && echo tree-nested-ok',
  '! echo "$TREE" | grep -qx "root-ignored.txt" && echo tree-root-ignore-ok',
  '! echo "$TREE" | grep -qx "nested/nested-ignored.txt" && echo tree-nested-ignore-ok',
  '! echo "$TREE" | grep -qx "secret-local.txt" && echo tree-exclude-ok',
  'echo run1-ok',
].join('\n');

const RUN_TWO_SCRIPT = [
  'set -eu',
  SHADOW_GIT_HELPERS,
  'mkdir -p results',
  'hist_setup',
  'H1=$(cat results/run1-head.txt)',
  // The run-one checkpoint metadata must have survived the container exit
  // and this fresh attach (fresh init container, fresh main container).
  'JSON1=$(jq -r .commitHash "$CKPT/run-one.json")',
  '[ "$JSON1" = "$H1" ] && echo checkpoint-json-survived-ok',
  'hist_env',
  '[ "$(git rev-parse HEAD)" = "$H1" ] && echo head-stable-ok',
  'printf "run two v2\\n" > tracked.txt',
  'printf "stray\\n" > added-after-run1.txt',
  'H2=$(hist_snapshot "run two snapshot")',
  'printf "%s" "$H2" > results/run2-head.txt',
  // The /restore flow: the commit hash comes from the persisted metadata.
  'hist_restore "$JSON1"',
  'grep -qx "run-one v1" tracked.txt && echo restore-content-ok',
  '[ ! -e added-after-run1.txt ] && echo restore-clean-ok',
  'echo run2-ok',
].join('\n');

const ARBITRARY_UID_SCRIPT = [
  'set -eu',
  SHADOW_GIT_HELPERS,
  'mkdir -p results',
  'id -u > results/arbitrary-uid.txt',
  'hist_setup',
  'hist_env',
  '[ "$(git rev-list --count HEAD)" -ge 2 ] && echo prior-history-readable-ok',
  'printf "uid edit\\n" > tracked.txt',
  'hist_snapshot "arbitrary uid snapshot" > /dev/null',
  'hist_restore "$(cat results/run1-head.txt)"',
  'grep -qx "run-one v1" tracked.txt && echo arbitrary-uid-restore-ok',
  'echo arbitrary-uid-ok',
].join('\n');

const COEXISTENCE_SCRIPT = [
  'set -eu',
  SHADOW_GIT_HELPERS,
  'mkdir -p results',
  'hist_setup',
  "printf 'private marker\\n' > node_modules/private-run-marker.txt",
  'hist_snapshot "coexistence snapshot" > results/coexist-head.txt',
  'test -e node_modules/private-run-marker.txt && echo coexist-private-ok',
  'echo coexist-ok',
].join('\n');

// --- host-side engine helpers -----------------------------------------------

interface LaunchResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runEngine(
  engine: string,
  argv: string[],
  timeoutMs: number,
  cwd?: string,
): LaunchResult {
  const result = spawnSync(engine, argv, {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 20 * 1024 * 1024,
    cwd,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr:
      (result.stderr ?? '') +
      (result.error === undefined ? '' : String(result.error)),
  };
}

function expectLaunchSucceeded(result: LaunchResult): void {
  if (result.status !== 0) {
    throw new Error(
      `Container session exited with status ${String(result.status)}.\n` +
        `--- stdout ---\n${result.stdout}\n` +
        `--- stderr ---\n${result.stderr}`,
    );
  }
}

function expectMarkers(result: LaunchResult, markers: readonly string[]): void {
  for (const marker of markers) {
    expect(result.stdout).toContain(marker);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface VolumeFacts {
  readonly exists: boolean;
  readonly labels: Record<string, string>;
}

function volumeFacts(engine: string, volumeName: string): VolumeFacts {
  const result = runEngine(
    engine,
    ['volume', 'inspect', volumeName, '--format', '{{json .Labels}}'],
    30_000,
  );
  if (result.status !== 0) {
    return { exists: false, labels: {} };
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (parsed !== null && typeof parsed === 'object') {
      return {
        exists: true,
        labels: Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(
            ([key, value]) => [key, String(value)],
          ),
        ),
      };
    }
  } catch {
    // fall through to the raw shape below
  }
  return { exists: true, labels: {} };
}

function listRunVolumes(engine: string, runId: string): string[] {
  const result = runEngine(
    engine,
    [
      'volume',
      'ls',
      '--filter',
      `label=${SANDBOX_DEPENDENCY_RUN_LABEL}=${runId}`,
      '--format',
      '{{.Name}}',
    ],
    30_000,
  );
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .sort();
}

function containerExists(engine: string, name: string): boolean {
  const result = runEngine(
    engine,
    ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'],
    30_000,
  );
  return result.status === 0 && result.stdout.trim() === name;
}

/**
 * Removes the engine-owned checkpoint store volume. Engine mediation makes
 * this safe whatever uid wrote the content (the #3450 finding); the test
 * must not leave persistent named volumes behind on shared hosts.
 */
function removeCheckpointVolume(engine: string, volumeName: string): void {
  runEngine(engine, ['volume', 'rm', '-f', volumeName], 60_000);
}

// --- production-argv session launcher ---------------------------------------

interface SessionOptions {
  readonly user?: string;
  readonly homeEnv?: string;
}

interface SessionResult extends LaunchResult {
  readonly containerName: string;
  readonly checkpointVolumeName: string;
}

/** A narrowed SandboxConfig for the engine under test (no blind cast). */
function engineConfig(engine: string): SandboxConfig {
  if (engine !== 'docker' && engine !== 'podman') {
    throw new Error(`Unsupported sandbox engine '${engine}'`);
  }
  return { command: engine, image: IMAGE };
}

/**
 * Builds the production container argv in production order (run args, volume
 * mounts, then the checkpoint attach, which really provisions the engine
 * volume + init container), appends a unique name, and runs one bash session
 * composed of the exact production prologue plus the requested work script.
 */
function runCheckpointSession(
  engine: string,
  fixture: FixtureWorkspace,
  workScript: string,
  options: SessionOptions = {},
): SessionResult {
  const config = engineConfig(engine);
  const workdir = realpathSync(fixture.repoRoot);
  const containerWorkdir = getContainerPath(workdir);
  const args = buildContainerRunArgs(
    config,
    IMAGE,
    workdir,
    containerWorkdir,
    realpathSync(tmpdir()),
  );
  const ttyIndex = args.indexOf('-t');
  if (ttyIndex !== -1) args.splice(ttyIndex, 1);
  if (options.user !== undefined) {
    args.push('--user', options.user);
  }
  if (options.homeEnv !== undefined) {
    args.push('--env', `HOME=${options.homeEnv}`);
  }
  const plan = planCheckpointStorage(config, workdir, true);
  expect(plan.enabled).toBe(true);
  attachPersistentCheckpointStore(config, args, plan);

  const containerName = `issue3464-${engine}-${randomUUID()}`;
  args.push('--name', containerName);

  const script = [CHECKPOINT_PROLOGUE, workScript].join('\n');
  const result = runEngine(
    engine,
    [...args, IMAGE, 'bash', '--noprofile', '--norc', '-c', script],
    SESSION_TIMEOUT_MS,
    fixture.repoRoot,
  );
  return {
    ...result,
    containerName,
    checkpointVolumeName: plan.volumeName,
  };
}

// --- gated image-global agent launcher ---------------------------------------

function runAgentSession(
  engine: string,
  fixture: FixtureWorkspace,
): LaunchResult {
  // The workspace bind uses the resolved physical path (process.cwd() inside
  // the CLI); on macOS os.tmpdir() is a /var/folders symlink prefix whose
  // realpath lives under /private/var/folders.
  const responsesPath = realpathSync(fixture.responses);
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
    SANDBOX_ENV: `LLXPRT_FAKE_RESPONSES=${responsesPath}`,
  };
  const result = spawnSync(
    process.execPath,
    [
      CLI_ENTRY,
      '--yolo',
      '--ide-mode',
      'disable',
      '--sandbox',
      '--sandbox-engine',
      engine,
      '--sandbox-image',
      IMAGE,
      '--provider',
      'fake',
      '--model',
      'fake-model',
      '--checkpointing',
      'Complete the session.',
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
    `status: ${String(result.status)}\n` +
      `--- stdout ---\n${result.stdout ?? ''}\n` +
      `--- stderr ---\n${result.stderr ?? ''}\n`,
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr:
      (result.stderr ?? '') +
      (result.error === undefined ? '' : String(result.error)),
  };
}

/** Reads the shadow repo HEAD through a probe container on the store. */
function probeStoreHead(
  engine: string,
  volumeName: string,
  projectKey: string,
): string {
  const result = runEngine(
    engine,
    [
      'run',
      '--rm',
      '--mount',
      `type=volume,src=${volumeName},dst=${CHECKPOINT_STORE_MOUNT_PATH}`,
      IMAGE,
      'git',
      '--git-dir',
      `${CHECKPOINT_STORE_MOUNT_PATH}/history/${projectKey}/.git`,
      'rev-parse',
      'HEAD',
    ],
    SESSION_TIMEOUT_MS,
  );
  expectLaunchSucceeded(result);
  return result.stdout.trim();
}

/** Writes a marker file into the store via a root probe container. */
function probeStoreTouch(
  engine: string,
  volumeName: string,
  projectKey: string,
  markerName: string,
): void {
  const result = runEngine(
    engine,
    [
      'run',
      '--rm',
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${volumeName},dst=${CHECKPOINT_STORE_MOUNT_PATH}`,
      IMAGE,
      'sh',
      '-c',
      `touch "${CHECKPOINT_STORE_MOUNT_PATH}/history/${projectKey}/${markerName}"`,
    ],
    SESSION_TIMEOUT_MS,
  );
  expectLaunchSucceeded(result);
}

function probeStoreFileExists(
  engine: string,
  volumeName: string,
  projectKey: string,
  markerName: string,
): boolean {
  const result = runEngine(
    engine,
    [
      'run',
      '--rm',
      '--mount',
      `type=volume,src=${volumeName},dst=${CHECKPOINT_STORE_MOUNT_PATH}`,
      IMAGE,
      'sh',
      '-c',
      `test -e "${CHECKPOINT_STORE_MOUNT_PATH}/history/${projectKey}/${markerName}"`,
    ],
    SESSION_TIMEOUT_MS,
  );
  return result.status === 0;
}

// --- the real-engine suites ---------------------------------------------------

interface EngineFixture {
  fixture: FixtureWorkspace;
  home: string;
  volumeName: string;
  projectKey: string;
  projectGitBefore: ReadonlyMap<string, string> | undefined;
  savedStorageEnv: NodeJS.ProcessEnv | undefined;
}

function describeEngine(engine: string): void {
  describe.skipIf(!ENGINES.includes(engine))(
    `Sandbox checkpoint persistence (real ${engine}) #3464`,
    () => {
      let ctx: EngineFixture;

      beforeAll(() => {
        const home = mkdtempSync(join(tmpdir(), `issue3464-${engine}-`));
        const fixture = buildFixture(home);
        const workdir = realpathSync(fixture.repoRoot);
        const projectKey = sha256(getContainerPath(workdir));
        const savedStorageEnv: NodeJS.ProcessEnv = {
          LLXPRT_CONFIG_HOME: process.env.LLXPRT_CONFIG_HOME,
          LLXPRT_DATA_HOME: process.env.LLXPRT_DATA_HOME,
          LLXPRT_CACHE_HOME: process.env.LLXPRT_CACHE_HOME,
          LLXPRT_LOG_HOME: process.env.LLXPRT_LOG_HOME,
        };
        // Isolate the launcher's Storage roots so no assertion depends on
        // (or mutates) the real user configuration.
        process.env.LLXPRT_CONFIG_HOME = join(fixture.storageRoot, 'config');
        process.env.LLXPRT_DATA_HOME = join(fixture.storageRoot, 'data');
        process.env.LLXPRT_CACHE_HOME = join(fixture.storageRoot, 'cache');
        process.env.LLXPRT_LOG_HOME = join(fixture.storageRoot, 'log');
        ctx = {
          fixture,
          home,
          volumeName: `${CHECKPOINT_VOLUME_NAME_PREFIX}${projectKey}`,
          projectKey,
          projectGitBefore: snapshotTree(join(fixture.repoRoot, '.git')),
          savedStorageEnv,
        };
      });

      afterAll(() => {
        if (ctx?.savedStorageEnv !== undefined) {
          for (const [key, value] of Object.entries(ctx.savedStorageEnv)) {
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        }
        if (ctx !== undefined) {
          removeCheckpointVolume(engine, ctx.volumeName);
          if (process.env.ISSUE3464_KEEP === undefined) {
            rmSync(ctx.home, { recursive: true, force: true });
          }
        }
      });

      function expectStoreLabels(): void {
        const facts = volumeFacts(engine, ctx.volumeName);
        expect(facts.exists).toBe(true);
        expect(facts.labels['com.vybestack.llxprt.sandbox-managed']).toBe(
          'true',
        );
        expect(facts.labels[SANDBOX_CHECKPOINT_STORE_LABEL]).toBe(
          ctx.projectKey,
        );
        expect(facts.labels[SANDBOX_CHECKPOINT_PERSISTENT_LABEL]).toBe('true');
        // The #3470 stale-run contract: persistent stores never carry the
        // per-run dependency label or process owner labels.
        expect(facts.labels[SANDBOX_DEPENDENCY_RUN_LABEL]).toBeUndefined();
        expect(
          facts.labels['com.vybestack.llxprt.sandbox-owner'],
        ).toBeUndefined();
      }

      function expectNoHostCheckpointState(): void {
        // Checkpoint state lives only in the engine-owned store: nothing
        // appears in the host data/log roots the launcher would have used.
        expect(
          existsSync(join(ctx.fixture.storageRoot, 'data', 'history')),
        ).toBe(false);
        expect(existsSync(join(ctx.fixture.storageRoot, 'log', 'tmp'))).toBe(
          false,
        );
        // And the project repository never gained checkpoint state.
        expect(
          existsSync(join(ctx.fixture.repoRoot, '.llxprt-checkpoint-store')),
        ).toBe(false);
        expect(snapshotTree(join(ctx.fixture.repoRoot, '.git'))).toStrictEqual(
          ctx.projectGitBefore,
        );
      }

      it(
        'run one creates a checkpoint, exits, and the store survives the container',
        () => {
          const session = runCheckpointSession(
            engine,
            ctx.fixture,
            RUN_ONE_SCRIPT,
          );
          expectLaunchSucceeded(session);
          expect(session.checkpointVolumeName).toBe(ctx.volumeName);
          expectMarkers(session, [
            'tree-tracked-ok',
            'tree-nested-ok',
            'tree-root-ignore-ok',
            'tree-nested-ignore-ok',
            'tree-exclude-ok',
            'run1-ok',
          ]);

          // The `--rm` container is gone; the engine-owned store is not.
          expect(containerExists(engine, session.containerName)).toBe(false);
          expectStoreLabels();
          expectNoHostCheckpointState();

          // The run-one metadata is inside the store, reachable through an
          // independent engine invocation (no container of this session).
          expect(
            probeStoreFileExists(
              engine,
              ctx.volumeName,
              ctx.projectKey,
              CHECKPOINT_STORE_MARKER_FILENAME,
            ),
          ).toBe(true);
          const head = probeStoreHead(engine, ctx.volumeName, ctx.projectKey);
          const recordedHead = readFileSync(
            join(ctx.fixture.repoRoot, 'results', 'run1-head.txt'),
            'utf8',
          ).trim();
          expect(head).toBe(recordedHead);
          expect(head).toMatch(/^[0-9a-f]{40}$/);
        },
        SESSION_TIMEOUT_MS * 2,
      );

      it(
        'a restarted sandbox reads the surviving history, snapshots again, and restores the run-one checkpoint',
        () => {
          const session = runCheckpointSession(
            engine,
            ctx.fixture,
            RUN_TWO_SCRIPT,
          );
          expectLaunchSucceeded(session);
          expectMarkers(session, [
            'checkpoint-json-survived-ok',
            'head-stable-ok',
            'restore-content-ok',
            'restore-clean-ok',
            'run2-ok',
          ]);
          expectStoreLabels();
          expectNoHostCheckpointState();

          // The restored workspace is observable from the host: the
          // run-one content is back and the post-snapshot stray file is gone.
          expect(
            readFileSync(join(ctx.fixture.repoRoot, 'tracked.txt'), 'utf8'),
          ).toBe('run-one v1\n');
          expect(
            existsSync(join(ctx.fixture.repoRoot, 'added-after-run1.txt')),
          ).toBe(false);
        },
        SESSION_TIMEOUT_MS * 2,
      );

      it(
        'an arbitrary selected uid shares the store: reads, commits, restores',
        () => {
          // Docker leaves HOME=/ for a uid without a passwd entry, which no
          // launcher can use; production's selected-uid path pins HOME to a
          // writable directory (sandbox-containers.ts setupContainerUser).
          // This session models exactly that topology for uid 54321.
          const session = runCheckpointSession(
            engine,
            ctx.fixture,
            ARBITRARY_UID_SCRIPT,
            { user: '54321:54321', homeEnv: '/tmp/issue3464-arbitrary-home' },
          );
          expectLaunchSucceeded(session);
          expectMarkers(session, [
            'prior-history-readable-ok',
            'arbitrary-uid-restore-ok',
            'arbitrary-uid-ok',
          ]);
          expect(
            readFileSync(
              join(ctx.fixture.repoRoot, 'results', 'arbitrary-uid.txt'),
              'utf8',
            ).trim(),
          ).toBe('54321');
          expect(
            readFileSync(join(ctx.fixture.repoRoot, 'tracked.txt'), 'utf8'),
          ).toBe('run-one v1\n');
          expectStoreLabels();
          expectNoHostCheckpointState();
        },
        SESSION_TIMEOUT_MS * 2,
      );

      it(
        'releasing #3450 dependency volumes keeps the checkpoint store and its restorable history',
        () => {
          // A session using BOTH features: private dependency volumes and
          // the persistent checkpoint store.
          const config = engineConfig(engine);
          const workdir = realpathSync(ctx.fixture.repoRoot);
          const containerWorkdir = getContainerPath(workdir);
          const args = buildContainerRunArgs(
            config,
            IMAGE,
            workdir,
            containerWorkdir,
            realpathSync(tmpdir()),
          );
          const ttyIndex = args.indexOf('-t');
          if (ttyIndex !== -1) args.splice(ttyIndex, 1);
          const lifecycle = addPrivateDependencyMounts(config, args, workdir);
          const plan = planCheckpointStorage(config, workdir, true);
          attachPersistentCheckpointStore(config, args, plan);
          const containerName = `issue3464-${engine}-${randomUUID()}`;
          args.push('--name', containerName);
          lifecycle.recordMainContainerName(containerName);

          const runId = args
            .filter((token) =>
              token.startsWith(`${SANDBOX_DEPENDENCY_RUN_LABEL}=`),
            )
            .map((token) =>
              token.slice(SANDBOX_DEPENDENCY_RUN_LABEL.length + 1),
            )[0];

          const script = [CHECKPOINT_PROLOGUE, COEXISTENCE_SCRIPT].join('\n');
          const session = runEngine(
            engine,
            [...args, IMAGE, 'bash', '--noprofile', '--norc', '-c', script],
            SESSION_TIMEOUT_MS,
            ctx.fixture.repoRoot,
          );
          expectLaunchSucceeded(session);
          expectMarkers(session, ['coexist-private-ok', 'coexist-ok']);

          const dependencyVolumes = listRunVolumes(engine, runId);
          expect(dependencyVolumes.length).toBeGreaterThan(0);

          // The dependency lifecycle releases its per-run volumes; the
          // checkpoint store is not lifecycle-managed and must survive.
          lifecycle.release();
          expect(listRunVolumes(engine, runId)).toStrictEqual([]);
          expectStoreLabels();

          // The surviving history still restores the run-one checkpoint.
          const restoreSession = runCheckpointSession(
            engine,
            ctx.fixture,
            [
              'set -eu',
              SHADOW_GIT_HELPERS,
              'hist_restore "$(jq -r .commitHash "$CKPT/run-one.json")"',
              'grep -qx "run-one v1" tracked.txt && echo post-release-restore-ok',
            ].join('\n'),
          );
          expectLaunchSucceeded(restoreSession);
          expectMarkers(restoreSession, ['post-release-restore-ok']);
          expectNoHostCheckpointState();
        },
        SESSION_TIMEOUT_MS * 3,
      );
    },
  );

  // Version skew: the in-container CLI (image built from a tree with #3464)
  // must refuse to present checkpointing when the launcher did not
  // provision the persistent store. Gated on the image actually containing
  // the fail-fast; the pre-#3464 registry image skips this gate.
  const imageHasFailFast =
    ENGINES.includes(engine) && imageHasCheckpointFailFast(engine, IMAGE);
  describe.skipIf(!ENGINES.includes(engine) || !imageHasFailFast)(
    `Sandbox checkpoint persistence version skew (real ${engine}) #3464`,
    () => {
      it(
        'an old launcher shape fails the session with the persistence error instead of discarding checkpoints',
        () => {
          const home = mkdtempSync(join(tmpdir(), `issue3464-skew-${engine}-`));
          const fixture = buildFixture(home);
          const savedStorageEnv: NodeJS.ProcessEnv = {
            LLXPRT_CONFIG_HOME: process.env.LLXPRT_CONFIG_HOME,
            LLXPRT_DATA_HOME: process.env.LLXPRT_DATA_HOME,
          };
          process.env.LLXPRT_CONFIG_HOME = join(fixture.storageRoot, 'config');
          process.env.LLXPRT_DATA_HOME = join(fixture.storageRoot, 'data');
          try {
            const config = engineConfig(engine);
            const workdir = realpathSync(fixture.repoRoot);
            const containerWorkdir = getContainerPath(workdir);
            // The OLD launcher shape: run args and mounts, but NO checkpoint
            // store attach and NO checkpoint entrypoint stanza, so a host from
            // before #3464 starting an image from after it.
            const args = buildContainerRunArgs(
              config,
              IMAGE,
              workdir,
              containerWorkdir,
              realpathSync(tmpdir()),
            );
            const ttyIndex = args.indexOf('-t');
            if (ttyIndex !== -1) args.splice(ttyIndex, 1);
            args.push('--env', 'SANDBOX=issue3464-version-skew');
            args.push('--name', `issue3464-skew-${engine}-${randomUUID()}`);

            const responsesPath = realpathSync(fixture.responses);
            args.push('--env', `LLXPRT_FAKE_RESPONSES=${responsesPath}`);
            // The production entrypoint shape for a pre-#3464 launcher:
            // the XDG pin stanza exists, the checkpoint stanza does not.
            const script = [
              XDG_HOME_PIN_STANZA,
              `exec llxprt --yolo --ide-mode disable --checkpointing --provider fake --model fake-model 'version skew probe'`,
            ].join('\n');
            const result = runEngine(
              engine,
              [...args, IMAGE, 'bash', '--noprofile', '--norc', '-c', script],
              AGENT_SESSION_TIMEOUT_MS,
              fixture.repoRoot,
            );
            expect(result.status).not.toBe(0);
            expect(`${result.stdout}\n${result.stderr}`).toContain(
              'persistent checkpoint store',
            );
          } finally {
            if (savedStorageEnv.LLXPRT_CONFIG_HOME === undefined) {
              delete process.env.LLXPRT_CONFIG_HOME;
            } else {
              process.env.LLXPRT_CONFIG_HOME =
                savedStorageEnv.LLXPRT_CONFIG_HOME;
            }
            if (savedStorageEnv.LLXPRT_DATA_HOME === undefined) {
              delete process.env.LLXPRT_DATA_HOME;
            } else {
              process.env.LLXPRT_DATA_HOME = savedStorageEnv.LLXPRT_DATA_HOME;
            }
            if (process.env.ISSUE3464_KEEP === undefined) {
              rmSync(home, { recursive: true, force: true });
            }
          }
        },
        AGENT_SESSION_TIMEOUT_MS * 2,
      );
    },
  );

  // Full CLI relaunch path: the entrypoint starts the image-global llxprt
  // with --checkpointing; the host launcher provisions the store. Engages
  // only when the image's global CLI can boot standalone AND contains this
  // tree's checkpoint persistence code (a pre-#3464 image's GitService
  // cannot initialize inside a container at all; see the version-skew
  // gate), so a locally built image (`npm run build:sandbox`) is required.
  const imageGlobalBoots =
    ENGINES.includes(engine) &&
    imageGlobalCliBoots(engine, IMAGE) &&
    imageHasFailFast;
  describe.skipIf(!ENGINES.includes(engine) || !imageGlobalBoots)(
    `Sandbox checkpoint persistence (real ${engine}) image-global agent #3464`,
    () => {
      it(
        'two --checkpointing sandbox sessions reuse the same persistent store',
        () => {
          const home = mkdtempSync(
            join(tmpdir(), `issue3464-${engine}-agent-`),
          );
          const fixture = buildFixture(home);
          const workdir = realpathSync(fixture.repoRoot);
          const projectKey = sha256(getContainerPath(workdir));
          const volumeName = `${CHECKPOINT_VOLUME_NAME_PREFIX}${projectKey}`;
          const savedStorageEnv: NodeJS.ProcessEnv = {
            LLXPRT_CONFIG_HOME: process.env.LLXPRT_CONFIG_HOME,
            LLXPRT_DATA_HOME: process.env.LLXPRT_DATA_HOME,
            LLXPRT_CACHE_HOME: process.env.LLXPRT_CACHE_HOME,
            LLXPRT_LOG_HOME: process.env.LLXPRT_LOG_HOME,
          };
          process.env.LLXPRT_CONFIG_HOME = join(fixture.storageRoot, 'config');
          process.env.LLXPRT_DATA_HOME = join(fixture.storageRoot, 'data');
          process.env.LLXPRT_CACHE_HOME = join(fixture.storageRoot, 'cache');
          process.env.LLXPRT_LOG_HOME = join(fixture.storageRoot, 'log');
          try {
            // Session one: the image CLI boots with checkpointing enabled;
            // its GitService must find the store marker through the full
            // production path and create the shadow repo inside the store.
            const first = runAgentSession(engine, fixture);
            expectLaunchSucceeded(first);

            const headOne = probeStoreHead(engine, volumeName, projectKey);
            expect(headOne).toMatch(/^[0-9a-f]{40}$/);
            // An independent engine invocation observes the marker and a
            // host-written probe marker that a recreated store would lose.
            expect(
              probeStoreFileExists(
                engine,
                volumeName,
                projectKey,
                CHECKPOINT_STORE_MARKER_FILENAME,
              ),
            ).toBe(true);
            const probeMarker = 'issue3464-reuse-probe';
            probeStoreTouch(engine, volumeName, projectKey, probeMarker);

            // Session two: a fresh full launch against the same project.
            const second = runAgentSession(engine, fixture);
            expectLaunchSucceeded(second);

            const headTwo = probeStoreHead(engine, volumeName, projectKey);
            expect(headTwo).toBe(headOne);
            expect(
              probeStoreFileExists(engine, volumeName, projectKey, probeMarker),
            ).toBe(true);
            const facts = volumeFacts(engine, volumeName);
            expect(facts.exists).toBe(true);
            expect(facts.labels[SANDBOX_CHECKPOINT_PERSISTENT_LABEL]).toBe(
              'true',
            );
            expect(facts.labels[SANDBOX_CHECKPOINT_STORE_LABEL]).toBe(
              projectKey,
            );
            expect(facts.labels[SANDBOX_DEPENDENCY_RUN_LABEL]).toBeUndefined();
          } finally {
            if (savedStorageEnv.LLXPRT_CONFIG_HOME === undefined) {
              delete process.env.LLXPRT_CONFIG_HOME;
            } else {
              process.env.LLXPRT_CONFIG_HOME =
                savedStorageEnv.LLXPRT_CONFIG_HOME;
            }
            if (savedStorageEnv.LLXPRT_DATA_HOME === undefined) {
              delete process.env.LLXPRT_DATA_HOME;
            } else {
              process.env.LLXPRT_DATA_HOME = savedStorageEnv.LLXPRT_DATA_HOME;
            }
            if (savedStorageEnv.LLXPRT_CACHE_HOME === undefined) {
              delete process.env.LLXPRT_CACHE_HOME;
            } else {
              process.env.LLXPRT_CACHE_HOME = savedStorageEnv.LLXPRT_CACHE_HOME;
            }
            if (savedStorageEnv.LLXPRT_LOG_HOME === undefined) {
              delete process.env.LLXPRT_LOG_HOME;
            } else {
              process.env.LLXPRT_LOG_HOME = savedStorageEnv.LLXPRT_LOG_HOME;
            }
            removeCheckpointVolume(engine, volumeName);
            if (process.env.ISSUE3464_KEEP === undefined) {
              rmSync(home, { recursive: true, force: true });
            }
          }
        },
        AGENT_SESSION_TIMEOUT_MS * 3,
      );
    },
  );
}

// The fixture creates POSIX shell scripts and symlinks; Windows hosts cannot.
if (process.platform !== 'win32') {
  describeEngine('docker');
  describeEngine('podman');
}
