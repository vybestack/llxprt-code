/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-container behavioral test for sandbox privilege hardening (#2902).
 *
 * This test obtains the container arguments FROM THE PRODUCTION FUNCTIONS
 * (`buildContainerRunArgs` and `setupContainerUser` in
 * packages/cli/src/utils/sandbox-containers.ts), filters them down to the
 * security-relevant flags, and launches a REAL Docker/Podman container using
 * those production-derived flags. It then asserts on OBSERVED KERNEL STATE
 * read from inside the container (/proc/self/status) — never on argv strings.
 *
 * The expected kernel-state values are INDEPENDENT LITERALS, not computed from
 * the production constants, so deleting the production hardening makes this
 * test FAIL (verified — see the falsifiability note in the plan). Both this
 * test and the unit test are independently falsifiable.
 *
 * Gating:
 *   - RUNS whenever a container runtime is usable and the sandbox image is
 *     present locally; SKIPS only when they genuinely are not. No CI opt-in.
 *   - Runtime selection honors `LLXPRT_SANDBOX=docker|podman` (set by the npm
 *     scripts) and `LLXPRT_SANDBOX_TEST_RUNTIME=<runtime>` (explicit override),
 *     so the nominal podman suite tests podman rather than silently testing
 *     docker.
 *   - Override the image with `LLXPRT_SANDBOX_TEST_IMAGE=<ref>`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContainerRunArgs,
  setupContainerUser,
} from '../packages/cli/src/utils/sandbox-containers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bounded per-run timeout so a hung runtime fails the test, not the suite.
const RUN_TIMEOUT_MS = 90_000;

// --- runtime + image resolution --------------------------------------------

function resolveSandboxImage(): string {
  if (process.env.LLXPRT_SANDBOX_TEST_IMAGE !== undefined) {
    return process.env.LLXPRT_SANDBOX_TEST_IMAGE;
  }
  // Resolve the tag the same way the product does: the config.sandboxImageUri
  // field of packages/cli/package.json.
  try {
    const pkgPath = join(__dirname, '..', 'packages', 'cli', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      config?: { sandboxImageUri?: string };
    };
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
    execFileSync(cmd, ['--version'], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function runtimeUsable(cmd: string): boolean {
  try {
    execFileSync(cmd, ['info'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

function imagePresent(cmd: string, image: string): boolean {
  try {
    const out = execFileSync(cmd, ['images', '-q', image], {
      timeout: 20_000,
    })
      .toString()
      .trim();
    return out !== '';
  } catch {
    return false;
  }
}

/**
 * Selects the runtime: an explicit test override
 * (LLXPRT_SANDBOX_TEST_RUNTIME) wins, then LLXPRT_SANDBOX when it is docker or
 * podman (set by the npm scripts), then auto-detection. Honoring
 * LLXPRT_SANDBOX prevents the nominal podman suite from silently testing
 * docker.
 */
function detectRuntime(): string | undefined {
  const sandboxPref =
    process.env.LLXPRT_SANDBOX === 'docker' ||
    process.env.LLXPRT_SANDBOX === 'podman'
      ? process.env.LLXPRT_SANDBOX
      : undefined;
  const requested = process.env.LLXPRT_SANDBOX_TEST_RUNTIME ?? sandboxPref;
  if (requested !== undefined) {
    return commandWorks(requested) && runtimeUsable(requested)
      ? requested
      : undefined;
  }
  for (const cmd of ['docker', 'podman']) {
    if (commandWorks(cmd) && runtimeUsable(cmd)) {
      return cmd;
    }
  }
  return undefined;
}

// --- production-derived flag extraction -------------------------------------

/**
 * Keeps only the security-relevant flags from a production argv: capability
 * drops/adds, --security-opt, and --user. The SOURCE is always the production
 * function output; the kernel-state assertions below are independent literals.
 */
function extractSecurityFlags(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--cap-drop=') || a.startsWith('--cap-add=')) {
      out.push(a);
    } else if (a === '--security-opt' || a === '--user') {
      out.push(a, args[i + 1] ?? '');
      i += 1;
    }
  }
  return out;
}

// --- container execution + parsing helpers ---------------------------------

function runInContainer(
  runtime: string,
  image: string,
  flagArgs: readonly string[],
  innerCommand: string,
): string {
  return execFileSync(
    runtime,
    ['run', '--rm', ...flagArgs, image, 'bash', '-lc', innerCommand],
    { timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
  ).toString();
}

/** Extracts a single-valued /proc/self/status field (e.g. NoNewPrivs). */
function statusField(output: string, name: string): string {
  const match = output.match(new RegExp(`^${name}:\\s+(\\S+)`, 'm'));
  if (match === null) {
    throw new Error(`${name} not found in container output:\n${output}`);
  }
  return match[1];
}

/** Parses the four Uid values (real effective saved fsuid) from a status dump. */
function parseUidLine(uidLine: string): {
  real: number;
  effective: number;
} {
  const tokens = uidLine.split(/\s+/);
  const real = Number.parseInt(tokens[1] ?? '', 10);
  const effective = Number.parseInt(tokens[2] ?? '', 10);
  if (Number.isNaN(real) || Number.isNaN(effective)) {
    throw new Error(`Failed to parse Uid line: ${uidLine}`);
  }
  return { real, effective };
}

const SETUP_USER_CMD = [
  'groupadd -f -g 12345 gemini',
  'id -u gemini >/dev/null 2>&1 || useradd -o -u 12345 -g 12345 -d /home/node -s /bin/bash gemini',
  'echo SU_CHECK=$(su -p gemini -c "id -u")',
].join('; ');

// --- gating -----------------------------------------------------------------

const runtime = detectRuntime();
const image = resolveSandboxImage();
const skipTests = runtime === undefined || !imagePresent(runtime, image);

describe.skipIf(skipTests)(
  'Sandbox privilege hardening (real container) #2902',
  () => {
    const savedSandboxFlags = process.env.SANDBOX_FLAGS;
    const savedSetUidGid = process.env.SANDBOX_SET_UID_GID;
    let fixtureWorkdir = '';

    beforeAll(() => {
      // Ensure the production argv is the clean default (no stray SANDBOX_FLAGS
      // or SANDBOX_SET_UID_GID from the test runner leaking into flag extraction).
      delete process.env.SANDBOX_FLAGS;
      delete process.env.SANDBOX_SET_UID_GID;
      fixtureWorkdir = mkdtempSync(join(tmpdir(), 'sandbox2902-real-'));
    });

    afterAll(() => {
      if (savedSandboxFlags !== undefined) {
        process.env.SANDBOX_FLAGS = savedSandboxFlags;
      } else {
        delete process.env.SANDBOX_FLAGS;
      }
      if (savedSetUidGid !== undefined) {
        process.env.SANDBOX_SET_UID_GID = savedSetUidGid;
      } else {
        delete process.env.SANDBOX_SET_UID_GID;
      }
      if (fixtureWorkdir !== '') {
        rmSync(fixtureWorkdir, { recursive: true, force: true });
      }
    });

    /** Security flags from the production default-path argv builder. */
    function defaultPathFlags(): string[] {
      const args = buildContainerRunArgs(
        { command: 'docker', image },
        image,
        fixtureWorkdir,
        '/workspace',
        fixtureWorkdir,
      );
      return extractSecurityFlags(args);
    }

    /** Security flags from the production current-user path (build + setup). */
    async function currentUserFlags(): Promise<string[]> {
      const args = buildContainerRunArgs(
        { command: 'docker', image },
        image,
        fixtureWorkdir,
        '/workspace',
        fixtureWorkdir,
      );
      process.env.SANDBOX_SET_UID_GID = 'true';
      try {
        // setupContainerUser pushes --user root and the capability add-backs;
        // its entrypoint rewrite is irrelevant here (we only read argv flags).
        await setupContainerUser(args, ['true']);
      } finally {
        delete process.env.SANDBOX_SET_UID_GID;
      }
      return extractSecurityFlags(args);
    }

    it('default path forbids new privileges and holds no capabilities (AC1, AC2, AC6)', () => {
      // The default (non-current-user) path adds no --user, so the container
      // runs as the image's default user (node, uid 1000) under cap-drop=ALL
      // and no-new-privileges.
      const out = runInContainer(
        runtime!,
        image,
        defaultPathFlags(),
        [
          'grep -E "^(NoNewPrivs|CapBnd|CapEff):" /proc/self/status',
          'echo ME_UID=$(id -u)',
        ].join('; '),
      );

      // Independent literals: a missing hardening flag makes these fail.
      expect(statusField(out, 'NoNewPrivs')).toBe('1');
      expect(statusField(out, 'CapBnd')).toBe('0000000000000000');
      expect(statusField(out, 'CapEff')).toBe('0000000000000000');
      // The default process is non-root.
      expect(out).toMatch(/ME_UID=1000\b/);
    });

    it('current-user path yields exactly the three minimal capabilities and groupadd/useradd/su succeed (AC3)', async () => {
      const out = runInContainer(
        runtime!,
        image,
        await currentUserFlags(),
        [
          'echo ROOT_CAPBND=$(grep "^CapBnd:" /proc/self/status | cut -f2)',
          'echo ROOT_NNPRIVS=$(grep "^NoNewPrivs:" /proc/self/status | cut -f2)',
          SETUP_USER_CMD,
        ].join('; '),
      );

      // CapBnd 0xc1 == CHOWN(bit0) | SETGID(bit6) | SETUID(bit7) — exactly the
      // three minimal capabilities. Independent literal, not derived.
      expect(out).toMatch(/ROOT_CAPBND=00000000000000c1\b/);
      // no-new-privileges is still in force on the current-user path.
      expect(out).toMatch(/ROOT_NNPRIVS=1\b/);
      // groupadd/useradd/su all succeeded: su dropped to uid 12345.
      expect(out).toMatch(/SU_CHECK=12345\b/);
    });

    it.each(['CHOWN', 'SETUID', 'SETGID'])(
      'current-user setup FAILS when %s is removed (AC3 leave-one-out minimum)',
      async (cap) => {
        // Start from the production current-user flags (source = production),
        // then remove exactly one capability and prove the setup breaks.
        const flags = (await currentUserFlags()).filter(
          (f) => f !== `--cap-add=${cap}`,
        );
        const out = runInContainer(runtime!, image, flags, SETUP_USER_CMD);

        // If the capability were not necessary, su would still reach uid 12345.
        expect(out).not.toMatch(/SU_CHECK=12345\b/);
      },
    );

    it('a non-root process cannot escalate through a setuid-root binary (AC6)', async () => {
      // Starts as root (current-user caps) so it can create a setuid-root
      // binary, then drops to the non-root `node` user and execs it. With
      // no-new-privileges the kernel ignores the setuid bit, so the exec'd
      // process keeps effective uid 1000. Falsifiable: without
      // --security-opt no-new-privileges the same binary yields effective uid 0.
      const out = runInContainer(
        runtime!,
        image,
        await currentUserFlags(),
        [
          'cp /bin/cat /tmp/rootcat',
          'chmod 4755 /tmp/rootcat',
          'echo NODE_UID=$(su -s /bin/bash node -c "id -u")',
          'echo ESCAL_UID_LINE=$(su -s /bin/bash node -c "/tmp/rootcat /proc/self/status" | grep "^Uid:")',
        ].join('; '),
      );

      expect(out).toMatch(/NODE_UID=1000\b/);
      const uidLineMatch = out.match(/ESCAL_UID_LINE=Uid:\s+(.*)/);
      expect(uidLineMatch).not.toBeNull();
      const { real, effective } = parseUidLine(`Uid: ${uidLineMatch![1]}`);
      expect(real).toBe(1000);
      // The setuid bit must NOT have elevated the effective uid.
      expect(effective).toBe(1000);
    });
  },
);

// ---------------------------------------------------------------------------
// Issue #3028: process memory hardening via prctl(PR_SET_DUMPABLE).
//
// Drives the PRODUCTION module inside a real container. The driver fixture
// spawns a CHILD process that calls the real `applyProcessMemoryHardening()`
// and holds a 64-hex secret in its heap; the PARENT reads
// /proc/<child>/{maps,mem} and scans for the secret. The parent-reads-child
// direction is the more permissive one (allowed under ptrace_scope 0 AND 1),
// so denying it implies denying the realistic descendant-reads-ancestor vector.
// This makes BOTH test arms Yama-independent. The container runs with the
// production security flags (sourced from `buildContainerRunArgs`), and
// `SANDBOX` is set in the container env so the production gate engages.
//
// A third test (AC4-E2E) exercises the real production hardening function
// (same import path and call signature as index.ts) inside the container and
// asserts the process's /proc files are root-owned, proving the real
// production code path hardens the process. A full index.ts launch is not
// possible in the current sandbox image (the core barrel transitively requires
// sharp, which is not installed); the lexical ordering test in the unit suite
// proves index.ts actually calls the function.
// ---------------------------------------------------------------------------

describe.skipIf(skipTests)(
  'Process memory hardening PR_SET_DUMPABLE (real container) #3028',
  () => {
    const repoRoot = join(__dirname, '..');
    const driverContainerPath =
      '/repo/integration-tests/fixtures/process-memory-hardening-driver.ts';
    const savedSandboxFlags = process.env.SANDBOX_FLAGS;
    const savedSetUidGid = process.env.SANDBOX_SET_UID_GID;
    let workdir = '';

    beforeAll(() => {
      // Ensure the production argv is the clean default (no stray SANDBOX_FLAGS
      // leaking into flag extraction), exactly as the #2902 tests do.
      delete process.env.SANDBOX_FLAGS;
      delete process.env.SANDBOX_SET_UID_GID;
      workdir = mkdtempSync(join(tmpdir(), 'sandbox3028-real-'));
    });

    afterAll(() => {
      if (savedSandboxFlags !== undefined) {
        process.env.SANDBOX_FLAGS = savedSandboxFlags;
      } else {
        delete process.env.SANDBOX_FLAGS;
      }
      if (savedSetUidGid !== undefined) {
        process.env.SANDBOX_SET_UID_GID = savedSetUidGid;
      } else {
        delete process.env.SANDBOX_SET_UID_GID;
      }
      if (workdir !== '') {
        rmSync(workdir, { recursive: true, force: true });
      }
    });

    /** Security flags production emits for a default-path run. */
    function productionSecurityFlags(): string[] {
      const args = buildContainerRunArgs(
        { command: 'docker', image },
        image,
        workdir,
        '/workspace',
        workdir,
      );
      return extractSecurityFlags(args);
    }

    /**
     * Runs the real production driver inside a container using the
     * production-derived security flags, with `SANDBOX` set to `sandboxEnv`
     * (engages the production gate when non-empty; an empty value disengages it
     * so the prctl call is never made). The repo is mounted read-only.
     */
    /**
     * Runs the driver fixture in a real container using the exact security
     * flags the production argv builder emits. `sandboxEnv` drives the
     * production gate; `extraArgs` selects the driver mode.
     */
    function runDriver(sandboxEnv: string, ...extraArgs: string[]): string {
      return execFileSync(
        runtime!,
        [
          'run',
          '--rm',
          ...productionSecurityFlags(),
          '--volume',
          `${repoRoot}:/repo:ro`,
          '--env',
          `SANDBOX=${sandboxEnv}`,
          '--env',
          'BUN_INSTALL_CACHE_DIR=/tmp/.bun',
          image,
          'bun',
          driverContainerPath,
          ...extraArgs,
        ],
        { timeout: RUN_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
      ).toString();
    }

    function runMemoryProbe(sandboxEnv: string): string {
      return runDriver(sandboxEnv);
    }

    /**
     * Runs the E2E driver mode, which spawns a child that calls the REAL
     * production `applyProcessMemoryHardening()` (same import path as
     * index.ts) inside the container, then stats /proc/<child>/maps ownership
     * to verify the real production function hardened the process.
     */
    function runE2EProbe(): string {
      return runDriver('e2e-probe', '__e2e__');
    }

    it('a parent process is DENIED the hardened child process maps (AC1, AC5)', () => {
      // SANDBOX set => production gate engages => prctl(PR_SET_DUMPABLE, 0) =>
      // the parent's read of /proc/<child>/maps is denied with EACCES. Parent
      // reads child (the permissive direction), so this denial holds under both
      // ptrace_scope 0 and 1.
      const out = runMemoryProbe('docker-memory-probe');
      expect(out).toContain('RESULT=MAPS_DENIED');
    });

    it('is falsifiable: with the production gate disengaged the secret IS recovered', () => {
      // The SAME real module and driver, but SANDBOX overridden to empty so the
      // production gate is a no-op and prctl(PR_SET_DUMPABLE) is never called.
      // The parent then reads the child's maps+mem and recovers the secret,
      // proving the prctl call in the production path is load-bearing. Parent
      // reads child is permitted under both ptrace_scope 0 and 1, so this
      // recovers the secret on Yama hosts too.
      const out = runMemoryProbe('');
      expect(out).toContain('RESULT=TOKEN_RECOVERED');
    });

    it('the real production hardening function makes the process non-dumpable (AC4-E2E)', () => {
      // Spawns a child that imports the REAL production module (same path as
      // index.ts) and calls the REAL applyProcessMemoryHardening(). The driver
      // stats /proc/<child>/maps ownership; non-dumpable makes it root-owned
      // (uid 0), proving the real production function makes the process
      // non-dumpable in a real container. A full index.ts launch is not
      // possible in this image (core barrel requires sharp); the lexical
      // ordering unit test proves index.ts actually calls the function.
      const out = runE2EProbe();
      expect(out).toContain('RESULT=E2E_HARDENED');
    });
  },
);
