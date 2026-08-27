/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2978: behavioural coverage for the published `llxprt` bin entry at
 * packages/cli/bin/llxprt.mjs.
 *
 * npm links ONLY the installed package's OWN bin entries on a global install, so
 * `bin` must live on packages/cli itself. The target must be a `#!/usr/bin/env
 * node` shim (NOT the POSIX `#!/bin/sh` launcher): npm v12 derives the Windows
 * cmd-shim from the bin target's shebang, and a `/bin/sh` shebang yields a
 * broken `.cmd` that invokes `/bin/sh` (absent on Windows).
 *
 * These tests execute the REAL shim against REAL directory trees containing a
 * REAL runnable Bun stand-in (the native bun.exe); nothing is mocked. The shim
 * is invoked via `node <shim>` so the resolution + exec logic is exercised on
 * every platform; the shebang correctness is asserted separately.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  readFileSync,
  statSync,
} from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(thisFile, '..', '..', '..');
const shimSrc = path.join(repoRoot, 'packages', 'cli', 'bin', 'llxprt.mjs');
const cliManifestPath = path.join(repoRoot, 'packages', 'cli', 'package.json');
// The native Bun binary stand-in. The published `bun` package names it bun.exe
// on every platform (its postinstall copies the native binary to that name), so
// it is executable on the current host despite the .exe suffix.
const stubBun = path.join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');

/**
 * Every fixture copies this binary to stand in for the bundled Bun. Fail with a
 * clear message rather than an opaque ENOENT from copyFileSync if the `bun`
 * package is missing or laid out differently.
 */
function requireStubBun(): string {
  if (!existsSync(stubBun)) {
    throw new Error(
      `Expected the bun package's native binary at ${stubBun}. ` +
        'Run `npm install` to restore it before running this suite.',
    );
  }
  return stubBun;
}

const LAUNCH_TIMEOUT_MS = 30_000;
const LAUNCHER_FAILURE_EXIT = 43;

const isWin = process.platform === 'win32';
// The shim probes bun.exe first on every platform; this mirrors that.
const bunExeName = 'bun.exe';

interface Layout {
  readonly root: string;
  readonly pkgRoot: string;
  readonly nodeModules: string;
  readonly shim: string;
}

/**
 * Builds the npm-installed shape the shim anchors against:
 *   <root>/node_modules/@vybestack/llxprt-code/bin/llxprt.mjs
 * The package root is exactly one directory above the bin/ directory, matching
 * the shim's `dirname(dirname(import.meta.url))` derivation.
 */
function makeLayout(root: string): Layout {
  const nodeModules = path.join(root, 'node_modules');
  const pkgRoot = path.join(nodeModules, '@vybestack', 'llxprt-code');
  const binDir = path.join(pkgRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  copyFileSync(shimSrc, path.join(binDir, 'llxprt.mjs'));
  return { root, pkgRoot, nodeModules, shim: path.join(binDir, 'llxprt.mjs') };
}

/**
 * Entry point the resolved Bun runs. It prints process.execPath (identifying
 * WHICH candidate ran) and the forwarded arguments, then optionally exits with
 * a code taken from LLXPRT_TEST_EXIT so exit-code propagation can be observed.
 */
const defaultEntryBody =
  'console.log(JSON.stringify({exe:process.execPath,argv:process.argv.slice(2)}));' +
  'let c=Number(process.env.LLXPRT_TEST_EXIT||"0");if(c)process.exit(c);';

function writeSourceEntry(pkgRoot: string, body: string): void {
  writeFileSync(path.join(pkgRoot, 'index.ts'), body);
}

function writeBundleEntry(pkgRoot: string, body: string): void {
  const dir = path.join(pkgRoot, 'bundle');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'llxprt.js'), body);
}

function placeBundledBun(nodeModules: string): string {
  const dir = path.join(nodeModules, 'bun', 'bin');
  mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, bunExeName);
  copyFileSync(requireStubBun(), exe);
  return exe;
}

/**
 * The @oven variant package names the host could select, covering both AVX2 and
 * baseline siblings so the binary is found regardless of the host's AVX2
 * detection result.
 */
function hostOvenVariants(): string[] {
  const key = `${process.platform}-${process.arch}`;
  const map: Record<string, string[]> = {
    'darwin-arm64': ['bun-darwin-aarch64'],
    'darwin-x64': ['bun-darwin-x64', 'bun-darwin-x64-baseline'],
    'linux-arm64': ['bun-linux-aarch64', 'bun-linux-aarch64-musl'],
    'linux-x64': [
      'bun-linux-x64',
      'bun-linux-x64-baseline',
      'bun-linux-x64-musl',
      'bun-linux-x64-musl-baseline',
    ],
    'win32-arm64': ['bun-windows-aarch64'],
    'win32-x64': ['bun-windows-x64', 'bun-windows-x64-baseline'],
  };
  return map[key] ?? [];
}

function placeOvenBun(nodeModules: string, variant: string): string {
  const pkgDir = path.join(nodeModules, '@oven', variant);
  const binDir = path.join(pkgDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  // A package.json is required so the shim's createRequire().resolve() can
  // locate the variant package via Node module resolution.
  writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: `@oven/${variant}`, version: '1.3.14' }),
  );
  const exe = path.join(binDir, bunExeName);
  copyFileSync(requireStubBun(), exe);
  return exe;
}

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the shim via `node`, forwarding `args` and merging `extraEnv` into the
 * environment. The shim uses stdio:'inherit', so the child Bun's output flows
 * to stdout/stderr which spawnSync captures.
 */
function runShim(
  layout: Layout,
  args: readonly string[] = [],
  extraEnv: Record<string, string> = {},
): RunResult {
  const result = spawnSync('node', [layout.shim, ...args], {
    cwd: layout.root,
    encoding: 'utf8',
    timeout: LAUNCH_TIMEOUT_MS,
    env: { ...process.env, ...extraEnv },
    ...(isWin ? { windowsHide: true } : {}),
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Parses the JSON line the entry prints, or returns null if absent. */
function parseEntryOutput(
  stdout: string,
): { exe: string; argv: string[] } | null {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith('{'));
  if (line === undefined) {
    return null;
  }
  try {
    return JSON.parse(line) as { exe: string; argv: string[] };
  } catch {
    return null;
  }
}

describe('packages/cli/bin/llxprt.mjs node-shebang shim (issue #2978)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'llxprt-shim-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('declares bin.llxprt -> bin/llxprt.mjs and ships the file', () => {
    const manifest = JSON.parse(readFileSync(cliManifestPath, 'utf8'));
    expect(manifest.bin?.llxprt).toBe('bin/llxprt.mjs');
    expect(manifest.files).toContain('bin');
    expect(existsSync(shimSrc)).toBe(true);
  });

  it('starts with a #!/usr/bin/env node shebang (NOT /bin/sh)', () => {
    // Regression guard for the original #2978 bug: a /bin/sh shebang makes npm
    // v12 emit a broken Windows .cmd. A node shebang is handled correctly.
    const firstLine = readFileSync(shimSrc, 'utf8').split('\n', 1)[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
    expect(firstLine).not.toContain('/bin/sh');
  });

  it('execs the bundled Bun with forwarded argv and propagates the child exit code', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, defaultEntryBody);

    const res = runShim(layout, ['--alpha', 'beta value'], {
      LLXPRT_TEST_EXIT: '7',
    });
    expect(res.status, `stderr: ${res.stderr}`).toBe(7);
    const out = parseEntryOutput(res.stdout);
    expect(out, `stdout: ${res.stdout}`).not.toBeNull();
    // Forwarded arguments reach the entry verbatim, including the embedded space.
    expect(out?.argv).toEqual(['--alpha', 'beta value']);
  });

  it('prefers the prebuilt bundle over the source entry', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    // A source entry that would fail if chosen; the bundle must win.
    writeSourceEntry(layout.pkgRoot, 'throw new Error("source must not run");');
    writeBundleEntry(layout.pkgRoot, 'console.log("BUNDLE_RAN");');

    const res = runShim(layout);
    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('BUNDLE_RAN');
  });

  it('LLXPRT_FORCE_SOURCE_ENTRY=1 forces the source entry even when a bundle exists', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, 'console.log("SOURCE_RAN");');
    // A bundle that would fail if chosen; the force flag must skip it.
    writeBundleEntry(
      layout.pkgRoot,
      'throw new Error("bundle must not run under force");',
    );

    const res = runShim(layout, [], { LLXPRT_FORCE_SOURCE_ENTRY: '1' });
    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('SOURCE_RAN');
  });

  it('exits 43 with a stderr diagnostic when the bundled Bun is missing', () => {
    const layout = makeLayout(tempDir);
    writeSourceEntry(layout.pkgRoot, defaultEntryBody);
    // No Bun placed anywhere.

    const res = runShim(layout);
    expect(res.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(res.stderr).toContain('Bun runtime was not found');
  });

  it('exits 43 with a stderr diagnostic when the entry point is missing', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    // No entry written (no index.ts, no bundle).

    const res = runShim(layout);
    expect(res.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(res.stderr).toContain('entry point was not found');
  });

  it('resolves Bun from the host @oven/bun-<variant> when bun/bin is absent', () => {
    const variants = hostOvenVariants();
    if (variants.length === 0) {
      // Unknown host tuple: the @oven table is finite, so skip rather than fail.
      console.log('No @oven variants known for this host; skipping');
      return;
    }
    const layout = makeLayout(tempDir);
    for (const variant of variants) {
      placeOvenBun(layout.nodeModules, variant);
    }
    writeSourceEntry(layout.pkgRoot, defaultEntryBody);

    const res = runShim(layout, ['--oven']);
    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    const out = parseEntryOutput(res.stdout);
    expect(out, `stdout: ${res.stdout}`).not.toBeNull();
    expect(out?.argv).toEqual(['--oven']);
  });
});

/**
 * Issue #3389: the shim SPAWNS Bun rather than exec'ing it, so descriptors are
 * not inherited automatically the way they were under the `#!/bin/sh` launcher
 * it replaced. The sandbox credential transport hands the capability token to
 * the CLI on fd 3 (named by LLXPRT_CAPABILITY_FD) and never puts it in the
 * environment, so dropping that descriptor made every container sandbox abort
 * at startup.
 *
 * These tests open a REAL descriptor 3 through `bash` and run the REAL shim, so
 * they observe what the CLI process actually receives.
 */
const CAPABILITY_TOKEN = 'a'.repeat(64);

/**
 * Entry body that reports the capability marker it was given, the identity of
 * whatever descriptor 3 is in this process, and the bytes it can read from it.
 *
 * The inode is what makes the leak assertion decisive. A closed descriptor 3 is
 * not observably closed from the child: the runtime reuses the number for its
 * own file opens, so probing content alone cannot distinguish "the host's
 * capability file was withheld" from "the host's file was passed but happened
 * to read oddly". Comparing inodes answers the identity question directly.
 */
const capabilityEntryBody = [
  'import fs from "node:fs";',
  'const out = { marker: process.env.LLXPRT_CAPABILITY_FD ?? null, ino: null, raw: "", err: "" };',
  'try { out.ino = String(fs.fstatSync(3).ino); } catch { out.ino = null; }',
  'try {',
  '  const buf = Buffer.alloc(128);',
  '  const read = fs.readSync(3, buf, 0, 128, null);',
  '  out.raw = buf.subarray(0, read).toString("utf8");',
  '} catch (error) {',
  '  out.err = error.code ?? String(error);',
  '}',
  'console.log(JSON.stringify(out));',
].join('\n');

interface CapabilityEntryOutput {
  readonly marker: string | null;
  readonly ino: string | null;
  readonly raw: string;
  readonly err: string;
}

function parseCapabilityOutput(stdout: string): CapabilityEntryOutput | null {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith('{'));
  if (line === undefined) {
    return null;
  }
  try {
    return JSON.parse(line) as CapabilityEntryOutput;
  } catch {
    return null;
  }
}

/**
 * Runs the shim with descriptor 3 already open on a file holding the token,
 * exactly as the sandbox entrypoint arranges it before exec'ing the CLI.
 */
function runShimWithOpenFd3(
  layout: Layout,
  extraEnv: Record<string, string> = {},
): RunResult & { readonly tokenIno: string } {
  const tokenFile = path.join(layout.root, 'capability-token');
  writeFileSync(tokenFile, `${CAPABILITY_TOKEN}\n`);
  const script = `exec 3<${JSON.stringify(tokenFile)}\nexec node ${JSON.stringify(layout.shim)}`;
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    cwd: layout.root,
    encoding: 'utf8',
    timeout: LAUNCH_TIMEOUT_MS,
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    tokenIno: String(statSync(tokenFile).ino),
  };
}

describe('packages/cli/bin/llxprt.mjs capability descriptor transport (issue #3389)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'llxprt-shim-cap-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.skipIf(isWin)(
    'forwards descriptor 3 to the Bun child when LLXPRT_CAPABILITY_FD names it',
    () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      writeSourceEntry(layout.pkgRoot, capabilityEntryBody);

      const res = runShimWithOpenFd3(layout, { LLXPRT_CAPABILITY_FD: '3' });

      expect(res.status, `stderr: ${res.stderr}`).toBe(0);
      const out = parseCapabilityOutput(res.stdout);
      expect(out, `stdout: ${res.stdout}`).not.toBeNull();
      expect(out?.marker).toBe('3');
      expect(out?.err).toBe('');
      // The child holds the very descriptor the host opened, not a lookalike.
      expect(out?.ino).toBe(res.tokenIno);
      expect(out?.raw).toBe(`${CAPABILITY_TOKEN}\n`);
    },
  );

  it.skipIf(isWin)(
    'does not leak an open descriptor 3 to the child when no marker is set',
    () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      writeSourceEntry(layout.pkgRoot, capabilityEntryBody);

      const res = runShimWithOpenFd3(layout);

      expect(res.status, `stderr: ${res.stderr}`).toBe(0);
      const out = parseCapabilityOutput(res.stdout);
      expect(out, `stdout: ${res.stdout}`).not.toBeNull();
      expect(out?.marker).toBeNull();
      // The runtime reuses descriptor 3 for its own opens, so the child cannot
      // observe it as closed. Identity settles it: whatever fd 3 is here, it is
      // not the host's capability file, and its bytes are not the token.
      expect(out?.ino).not.toBe(res.tokenIno);
      expect(out?.raw).not.toContain(CAPABILITY_TOKEN);
    },
  );

  it.skipIf(isWin)(
    'exits 43 without running the CLI when the marker names any descriptor but 3',
    () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      writeSourceEntry(layout.pkgRoot, 'console.log("CLI_RAN");');

      const res = runShimWithOpenFd3(layout, { LLXPRT_CAPABILITY_FD: '4' });

      expect(res.status).toBe(LAUNCHER_FAILURE_EXIT);
      expect(res.stderr).toContain('LLXPRT_CAPABILITY_FD');
      expect(res.stdout).not.toContain('CLI_RAN');
    },
  );
});
