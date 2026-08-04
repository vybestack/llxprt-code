/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2962: on macOS the launcher prefers a Bun already on PATH when it
 * meets the pinned version floor, and only falls back to the bundled binary
 * otherwise.
 *
 * Why this matters: npm removes and re-extracts the entire package tree on
 * every install — including the nested bun dependency, even when that
 * dependency did not change — which unlinks the executable of every running
 * session. On macOS an unlinked executable cannot be identified by securityd,
 * so Keychain ACLs can no longer be evaluated and every credential operation
 * degrades to a login-password prompt. Exec'ing a Bun that npm does not own
 * removes the trigger.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  launcherPath,
  STANDARD_LAUNCH_TIMEOUT_MS,
  expectNoSpawnError,
  realBunVersion,
  makeLayout,
  makePinnedLayout,
} from './launcher-test-helpers.js';

const BUNDLED_MARKER = 'BUNDLED_BUN_RAN_ENTRY';
const STUB_MARKER = 'STUB_BUN_EXECED';
const BUNDLED_ENTRY_CODE = `console.log('${BUNDLED_MARKER}');`;

const describeDarwinOnly =
  process.platform === 'darwin' ? describe : describe.skip;

/**
 * Creates a stub `bun` on a private bin directory. The stub answers
 * `--version` with the supplied version and otherwise announces that it was
 * exec'd, so tests can tell which runtime the launcher chose.
 */
function makeStubBunDir(root: string, version: string): string {
  const binDir = join(root, `stub-bin-${version}`);
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, 'bun');
  writeFileSync(
    stub,
    [
      '#!/bin/sh',
      'if [ "${1:-}" = "--version" ]; then',
      `  printf '%s\\n' '${version}'`,
      '  exit 0',
      'fi',
      `printf '${STUB_MARKER}\\n'`,
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(stub, 0o755);
  return binDir;
}

/**
 * Asserts a clean exit, surfacing stderr in the failure message. Bun's `expect`
 * takes no message argument, so the diagnostic is raised explicitly rather than
 * losing the launcher's own error output on failure.
 */
function expectExitOk(result: { status: number | null; stderr: string }): void {
  if (result.status !== 0) {
    throw new Error(
      `launcher exited with status ${result.status}: ${result.stderr}`,
    );
  }
}

/** Bumps the patch component of a dotted version by one. */
function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split('-')[0].split('.');
  return `${major}.${minor}.${Number(patch) + 1}`;
}

function runLauncher(
  launcherTarget: string,
  pkgRoot: string,
  pathValue: string,
  args: string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync(launcherTarget, args, {
    cwd: pkgRoot,
    encoding: 'utf8',
    timeout: STANDARD_LAUNCH_TIMEOUT_MS,
    env: { ...process.env, PATH: pathValue },
  });
}

// --- Issue #3021 fixtures -------------------------------------------------
//
// The launcher inspects the selected PATH Bun's designated code-signing
// requirement on Darwin and warns when it carries no team-identity clause
// (`certificate leaf[subject.OU]`). These fixtures stub the external tools the
// launcher shells out to (codesign, uname, od) so the real launcher script is
// exercised against controlled inputs, mirroring how a real ad-hoc or
// Oven-signed Bun would present itself.

/**
 * Distinctive substring present exactly once in the advisory warning block.
 * Chosen to be specific to the no-team-identity condition (which covers
 * ad-hoc, cdhash-only, and unsigned PATH Buns alike), not merely the
 * "ad-hoc" label, so the wording stays accurate for all warn cases.
 */
const WARNING_NEEDLE = 'lacks a stable team identity';
const REMEDY_BREW = 'brew uninstall bun && brew install oven-sh/bun/bun';
const REMEDY_CURL = 'curl -fsSL https://bun.com/install | bash';

/**
 * Per-test timeout for launcher spawn tests. The launcher exec's the real
 * bundled Bun for the non-Darwin (forced-kernel) cases, whose cold start can
 * exceed bun:test's 5s default; this stays comfortably above the spawnSync
 * timeout so a hung process is reported by the spawn, not the test runner.
 */
const LAUNCHER_TEST_TIMEOUT_MS = 45_000;

/** cdhash-only designated requirement, like homebrew/core's ad-hoc Bun. */
const DR_CDHASH_ONLY =
  'designated => cdhash H"f73edee81b5af18948a4dab2dd158319d3dcacfd"';

/** Oven Developer-ID designated requirement with a team-identity clause. */
const DR_OVEN_IDENTITY =
  'designated => identifier "bun" and anchor apple generic and ' +
  'certificate leaf[subject.OU] = "7FRXF46ZSN"';

/**
 * Options for the codesign stub. The stub always proves it received exactly
 * the launcher's four-argument invocation (`-d --requirements - <target>`),
 * recording an invocation marker so non-Darwin branches can be shown to never
 * reach codesign.
 */
interface CodesignStubOptions {
  /** Designated requirement printed to stdout on success (exit 0). */
  requirement?: string;
  /**
   * When set, the stub verifies its arguments, writes this string to stderr,
   * and exits 1 — mimicking codesign rejecting an unsigned or unqualified
   * binary. Takes precedence over `requirement`.
   */
  failDiagnostic?: string;
  /**
   * The exact PATH-Bun path the stub must receive as its fourth argument.
   * When omitted the fourth argument is not range-checked (used for stubs
   * that are never expected to run, e.g. the non-Darwin branches).
   */
  expectedTarget?: string;
}

/**
 * Builds a private bin directory containing a stub `codesign` that:
 *   - writes an invocation marker (proving the launcher reached codesign at
 *     all, used to assert the non-Darwin branches never inspect signatures);
 *   - asserts it received exactly four arguments in the exact order the
 *     launcher emits (`-d`, `--requirements`, `-`, <PATH Bun>), exiting 2 on
 *     any mismatch so a wrong target or ordering fails the test rather than
 *     silently producing a misleading requirement;
 *   - then either prints the supplied designated requirement to stdout
 *     (success) or writes `failDiagnostic` to stderr and exits 1 (failure).
 *
 * Returns the bin directory and the path to the invocation marker so callers
 * can assert presence/absence across the Darwin and non-Darwin cases.
 */
function makeCodesignStubDir(
  root: string,
  opts: CodesignStubOptions,
): { binDir: string; markerPath: string } {
  const tag =
    opts.failDiagnostic !== undefined ? 'codesign-fail' : 'codesign-stub';
  const binDir = join(root, tag);
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, 'codesign');
  const markerPath = join(binDir, 'invoked.marker');
  const lines: string[] = ['#!/bin/sh'];
  // Record that codesign was reached, before any argument checking, so a
  // non-Darwin branch that never shells out leaves no marker.
  lines.push(`printf '1' > "${markerPath}"`);
  // The launcher always invokes: codesign -d --requirements - <target>.
  // Fail (exit 2) on a wrong argument count or any mismatched positional,
  // so the test can't pass on a mis-ordered or wrong-target invocation.
  lines.push('[ "$#" -eq 4 ] || exit 2');
  lines.push('[ "$1" = "-d" ] || exit 2');
  lines.push('[ "$2" = "--requirements" ] || exit 2');
  lines.push('[ "$3" = "-" ] || exit 2');
  if (opts.expectedTarget !== undefined) {
    // Compare against a file so a path containing shell metacharacters cannot
    // break the generated script; command substitution strips the trailing
    // newline.
    const targetFile = join(binDir, 'expected-target');
    writeFileSync(targetFile, opts.expectedTarget);
    lines.push(`[ "$4" = "$(cat "${targetFile}")" ] || exit 2`);
  }
  if (opts.failDiagnostic !== undefined) {
    const diagFile = join(binDir, 'diagnostic.txt');
    writeFileSync(
      diagFile,
      `${opts.failDiagnostic}
`,
    );
    lines.push(`cat "${diagFile}" >&2`);
    lines.push('exit 1');
  } else {
    const drFile = join(binDir, 'dr.txt');
    writeFileSync(
      drFile,
      `${opts.requirement ?? ''}
`,
    );
    lines.push(`cat "${drFile}"`);
    lines.push('exit 0');
  }
  lines.push('');
  writeFileSync(stub, lines.join(String.fromCharCode(10)));
  chmodSync(stub, 0o755);
  return { binDir, markerPath };
}

/**
 * Builds a private bin directory containing a stub `uname` that always reports
 * the supplied kernel string, regardless of arguments. Lets a Darwin host
 * exercise the launcher's non-Darwin branches.
 */
function makeUnameStubDir(root: string, kernel: string): string {
  const binDir = join(root, 'uname-stub');
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, 'uname');
  writeFileSync(
    stub,
    `#!/bin/sh
echo '${kernel}'
`,
  );
  chmodSync(stub, 0o755);
  return binDir;
}

/**
 * Builds a private bin directory containing a stub `od` that emits the
 * supplied magic bytes. The launcher strips spaces/newlines from od's output,
 * so the magic is given as a compact hex string (e.g. "7f454c46" for ELF).
 */
function makeOdStubDir(root: string, magic: string): string {
  const binDir = join(root, 'od-stub');
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, 'od');
  writeFileSync(
    stub,
    `#!/bin/sh
echo '${magic}'
`,
  );
  chmodSync(stub, 0o755);
  return binDir;
}

/** Joins stub bin directories ahead of a minimal system PATH. */
function makePath(...stubDirs: string[]): string {
  return [...stubDirs, '/usr/bin', '/bin'].join(':');
}

/** Counts non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

describe('POSIX launcher system-Bun preference source gating', () => {
  it('gates the PATH probe on Darwin only', () => {
    const source = readFileSync(launcherPath, 'utf8');
    // Match the executable probe itself, not the prose in the comment above it.
    const probeIndex = source.indexOf(
      '_llxprt_path_bun_version=$(bun --version 2>/dev/null)',
    );
    expect(probeIndex).toBeGreaterThan(-1);
    // The probe must sit inside a Darwin-gated conditional so Linux and
    // Windows resolution stays exactly as it was.
    const guard = source.lastIndexOf(
      '[ "$_llxprt_kernel" = "Darwin" ]',
      probeIndex,
    );
    expect(guard).toBeGreaterThan(-1);
    // Nothing may close the conditional between the guard and the probe.
    expect(/\nfi\n/.test(source.slice(guard, probeIndex))).toBe(false);
  });
});

describeDarwinOnly('POSIX launcher system-Bun preference (issue #2962)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-sysbun-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefers a PATH Bun that is newer than the pinned floor', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = makeStubBunDir(tempDir, bumpPatch(realBunVersion()));
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    expectExitOk(result);
    expect(result.stdout).toContain(STUB_MARKER);
    expect(result.stdout).not.toContain(BUNDLED_MARKER);
  });

  it('accepts a PATH Bun exactly at the pinned floor', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = makeStubBunDir(tempDir, realBunVersion());
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    expectExitOk(result);
    expect(result.stdout).toContain(STUB_MARKER);
  });

  it('falls back to the bundled Bun when the PATH Bun is below the floor', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = makeStubBunDir(tempDir, '1.0.0');
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    expectExitOk(result);
    expect(result.stdout).toContain(BUNDLED_MARKER);
    expect(result.stdout).not.toContain(STUB_MARKER);
  });

  it('falls back to the bundled Bun when no Bun is on PATH', () => {
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const result = runLauncher(launcherTarget, pkgRoot, '/usr/bin:/bin');
    expectNoSpawnError(result);
    expectExitOk(result);
    expect(result.stdout).toContain(BUNDLED_MARKER);
  });

  it('ignores a PATH Bun when the package pin cannot be read', () => {
    // Without a readable pin there is no floor to compare against, so the
    // launcher must not accept an arbitrary PATH Bun.
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: BUNDLED_ENTRY_CODE,
    });
    const stubDir = makeStubBunDir(tempDir, '99.0.0');
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      `${stubDir}:/usr/bin:/bin`,
    );
    expectNoSpawnError(result);
    // Assert the fallback actually succeeded, not merely that the stub was
    // skipped: an unreadable pin must still launch via the bundled runtime.
    expectExitOk(result);
    expect(result.stdout).toContain(BUNDLED_MARKER);
    expect(result.stdout).not.toContain(STUB_MARKER);
  });

  it('forwards arguments through the PATH Bun with exact positional boundaries', () => {
    // This runs through a controlled warning-triggering PATH-Bun path: a
    // cdhash-only codesign stub is on PATH so the #3021 inspection fires
    // deterministically, and the PATH Bun is still exec'd unchanged. The stub
    // Bun emits the argument count and each positional argument on its own
    // delimited line so boundary errors (a space-split "a b", an expanded
    // "$HOME", a mangled multi-byte arg) are detected rather than hidden by
    // the flattened "$*" join the launcher used previously.
    const { pkgRoot, launcherTarget } = makePinnedLayout(
      tempDir,
      BUNDLED_ENTRY_CODE,
    );
    const stubDir = join(tempDir, 'stub-args');
    mkdirSync(stubDir, { recursive: true });
    const stub = join(stubDir, 'bun');
    writeFileSync(
      stub,
      [
        '#!/bin/sh',
        'if [ "${1:-}" = "--version" ]; then',
        `  printf '%s\\n' '${bumpPatch(realBunVersion())}'`,
        '  exit 0',
        'fi',
        'shift',
        `printf 'ARGCOUNT:%s\\n' "$#"`,
        '_i=1',
        'for _a in "$@"; do',
        `  printf 'ARG[%s]:%s\\n' "$_i" "$_a"`,
        '  _i=$((_i + 1))',
        'done',
        '',
      ].join('\n'),
    );
    chmodSync(stub, 0o755);
    const codesign = makeCodesignStubDir(tempDir, {
      requirement: DR_CDHASH_ONLY,
      expectedTarget: stub,
    });
    const result = runLauncher(
      launcherTarget,
      pkgRoot,
      makePath(stubDir, codesign.binDir),
      ['a b', 'ünicode', '$HOME'],
    );
    expectNoSpawnError(result);
    expectExitOk(result);
    // The controlled warning path fired.
    expect(existsSync(codesign.markerPath)).toBe(true);
    expect(result.stderr).toContain(WARNING_NEEDLE);
    // Exactly three arguments forwarded, with exact positional boundaries.
    expect(result.stdout).toContain('ARGCOUNT:3');
    expect(result.stdout).toContain('ARG[1]:a b');
    expect(result.stdout).toContain('ARG[2]:ünicode');
    expect(result.stdout).toContain('ARG[3]:$HOME');
  });
});

describeDarwinOnly(
  'POSIX launcher ad-hoc PATH Bun warning (issue #3021)',
  () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'llxprt-adhoc-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it(
      'warns exactly once and still execs the PATH Bun when the requirement is cdhash-only',
      () => {
        const { pkgRoot, launcherTarget } = makePinnedLayout(
          tempDir,
          BUNDLED_ENTRY_CODE,
        );
        const bunDir = makeStubBunDir(tempDir, bumpPatch(realBunVersion()));
        const codesign = makeCodesignStubDir(tempDir, {
          requirement: DR_CDHASH_ONLY,
          expectedTarget: join(bunDir, 'bun'),
        });
        const result = runLauncher(
          launcherTarget,
          pkgRoot,
          makePath(bunDir, codesign.binDir),
        );
        expectNoSpawnError(result);
        expectExitOk(result);
        // codesign was reached and proved it received the launcher's exact
        // four-argument invocation against the selected PATH Bun.
        expect(existsSync(codesign.markerPath)).toBe(true);
        // The selected PATH Bun must still run; the warning is advisory.
        expect(result.stdout).toContain(STUB_MARKER);
        expect(result.stdout).not.toContain(BUNDLED_MARKER);
        expect(result.stderr).toContain(WARNING_NEEDLE);
        expect(result.stderr).toContain('Keychain');
        expect(result.stderr).toContain('Always Allow');
        expect(result.stderr).toContain(REMEDY_BREW);
        expect(result.stderr).toContain(REMEDY_CURL);
        expect(countOccurrences(result.stderr, WARNING_NEEDLE)).toBe(1);
      },
      LAUNCHER_TEST_TIMEOUT_MS,
    );

    it(
      'warns exactly once and still execs the PATH Bun when codesign reports unsigned',
      () => {
        const { pkgRoot, launcherTarget } = makePinnedLayout(
          tempDir,
          BUNDLED_ENTRY_CODE,
        );
        const bunDir = makeStubBunDir(tempDir, bumpPatch(realBunVersion()));
        const codesign = makeCodesignStubDir(tempDir, {
          failDiagnostic: 'code object is not signed at all',
          expectedTarget: join(bunDir, 'bun'),
        });
        const result = runLauncher(
          launcherTarget,
          pkgRoot,
          makePath(bunDir, codesign.binDir),
        );
        expectNoSpawnError(result);
        expectExitOk(result);
        expect(existsSync(codesign.markerPath)).toBe(true);
        expect(result.stdout).toContain(STUB_MARKER);
        expect(result.stdout).not.toContain(BUNDLED_MARKER);
        expect(result.stderr).toContain(WARNING_NEEDLE);
        expect(result.stderr).toContain(REMEDY_BREW);
        expect(result.stderr).toContain(REMEDY_CURL);
        expect(countOccurrences(result.stderr, WARNING_NEEDLE)).toBe(1);
      },
      LAUNCHER_TEST_TIMEOUT_MS,
    );

    it(
      'warns and still execs when a failing codesign echoes the team-identity clause in its diagnostic',
      () => {
        // Regression: codesign exits non-zero while its diagnostic happens to
        // contain `certificate leaf[subject.OU]`. The launcher must still warn
        // (only a *successful* codesign carrying the clause suppresses it) and
        // must still execute the selected PATH Bun.
        const { pkgRoot, launcherTarget } = makePinnedLayout(
          tempDir,
          BUNDLED_ENTRY_CODE,
        );
        const bunDir = makeStubBunDir(tempDir, bumpPatch(realBunVersion()));
        const codesign = makeCodesignStubDir(tempDir, {
          failDiagnostic:
            'code failed to satisfy designated requirement: ' +
            'certificate leaf[subject.OU] = "7FRXF46ZSN"',
          expectedTarget: join(bunDir, 'bun'),
        });
        const result = runLauncher(
          launcherTarget,
          pkgRoot,
          makePath(bunDir, codesign.binDir),
        );
        expectNoSpawnError(result);
        expectExitOk(result);
        expect(existsSync(codesign.markerPath)).toBe(true);
        // The PATH Bun must still run despite the failing codesign.
        expect(result.stdout).toContain(STUB_MARKER);
        expect(result.stdout).not.toContain(BUNDLED_MARKER);
        expect(result.stderr).toContain(WARNING_NEEDLE);
        expect(result.stderr).toContain(REMEDY_BREW);
        expect(result.stderr).toContain(REMEDY_CURL);
        expect(countOccurrences(result.stderr, WARNING_NEEDLE)).toBe(1);
      },
      LAUNCHER_TEST_TIMEOUT_MS,
    );

    it(
      'does not warn when the PATH Bun carries an Oven team-identity requirement',
      () => {
        const { pkgRoot, launcherTarget } = makePinnedLayout(
          tempDir,
          BUNDLED_ENTRY_CODE,
        );
        const bunDir = makeStubBunDir(tempDir, bumpPatch(realBunVersion()));
        const codesign = makeCodesignStubDir(tempDir, {
          requirement: DR_OVEN_IDENTITY,
          expectedTarget: join(bunDir, 'bun'),
        });
        const result = runLauncher(
          launcherTarget,
          pkgRoot,
          makePath(bunDir, codesign.binDir),
        );
        expectNoSpawnError(result);
        expectExitOk(result);
        expect(existsSync(codesign.markerPath)).toBe(true);
        expect(result.stdout).toContain(STUB_MARKER);
        expect(result.stdout).not.toContain(BUNDLED_MARKER);
        expect(result.stderr).not.toContain(WARNING_NEEDLE);
      },
      LAUNCHER_TEST_TIMEOUT_MS,
    );
  },
);

describeDarwinOnly(
  'POSIX launcher signature warning is Darwin-only (issue #3021)',
  () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'llxprt-adhoc-nodarwin-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it(
      'does not inspect or warn under a Linux kernel',
      () => {
        const { pkgRoot, launcherTarget } = makePinnedLayout(
          tempDir,
          BUNDLED_ENTRY_CODE,
        );
        const unameDir = makeUnameStubDir(tempDir, 'Linux');
        const odDir = makeOdStubDir(tempDir, '7f454c46');
        const codesign = makeCodesignStubDir(tempDir, {
          requirement: DR_CDHASH_ONLY,
        });
        const result = runLauncher(
          launcherTarget,
          pkgRoot,
          makePath(unameDir, odDir, codesign.binDir),
        );
        expectNoSpawnError(result);
        expectExitOk(result);
        // Non-Darwin kernels must never inspect signatures: codesign is not
        // reached, so no invocation marker is written.
        expect(existsSync(codesign.markerPath)).toBe(false);
        expect(result.stdout).toContain(BUNDLED_MARKER);
        expect(result.stderr).not.toContain(WARNING_NEEDLE);
      },
      LAUNCHER_TEST_TIMEOUT_MS,
    );

    it(
      'does not inspect or warn under a Windows-like (MINGW) kernel',
      () => {
        const { pkgRoot, launcherTarget } = makePinnedLayout(
          tempDir,
          BUNDLED_ENTRY_CODE,
        );
        const unameDir = makeUnameStubDir(tempDir, 'MINGW64_NT-10.0');
        const odDir = makeOdStubDir(tempDir, '4d5a');
        const codesign = makeCodesignStubDir(tempDir, {
          requirement: DR_CDHASH_ONLY,
        });
        const result = runLauncher(
          launcherTarget,
          pkgRoot,
          makePath(unameDir, odDir, codesign.binDir),
        );
        expectNoSpawnError(result);
        expectExitOk(result);
        expect(existsSync(codesign.markerPath)).toBe(false);
        expect(result.stdout).toContain(BUNDLED_MARKER);
        expect(result.stderr).not.toContain(WARNING_NEEDLE);
      },
      LAUNCHER_TEST_TIMEOUT_MS,
    );
  },
);
