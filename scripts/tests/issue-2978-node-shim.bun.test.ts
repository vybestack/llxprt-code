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
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  statSync,
} from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_INTERVAL_MS,
  MAX_SNAPSHOT_HEAP_MB_LIMIT,
} from '../memory/probe.ts';
import {
  LAUNCHER_FAILURE_EXIT,
  LAUNCH_TIMEOUT_MS,
  cliManifestPath,
  defaultEntryBody,
  hostOvenVariants,
  isWin,
  makeLayout,
  parseEntryOutput,
  placeBundledBun,
  placeOvenBun,
  readCapture,
  runShim,
  shimSrc,
  writeBundleEntry,
  writeProfileLauncher,
  writeProfilerEntry,
  writeSourceEntry,
  type Layout,
  type RunResult,
} from './issue-2978-node-shim-helpers.ts';

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

describe('packages/cli/bin/llxprt.mjs memory-profile dispatch (issue #3386)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'llxprt-shim-profile-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses the same numeric limits as the memory probe', () => {
    const shim = readFileSync(shimSrc, 'utf8');
    const readNumericConstant = (name: string): number => {
      const match = shim.match(new RegExp(`const ${name} = ([0-9_]+);`));
      if (match?.[1] === undefined) {
        throw new Error(`Missing numeric shim constant ${name}`);
      }
      return Number(match[1].replaceAll('_', ''));
    };

    expect(readNumericConstant('MAX_INTERVAL_MS')).toBe(MAX_INTERVAL_MS);
    expect(readNumericConstant('MAX_SNAPSHOT_HEAP_MB_LIMIT')).toBe(
      MAX_SNAPSHOT_HEAP_MB_LIMIT,
    );
  });

  it('selects the profile launcher for exact activation and keeps ordinary argv in order', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, 'throw new Error("ordinary entry ran");');
    writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_RAN');

    const res = runShim(layout, [
      '--provider',
      'fake',
      '--memprofile-dir',
      'run path',
      '--memprofile',
      'prompt one',
      '--memprofile-snapshots',
      '--model',
      'fake-model',
      '--memprofile-max-heap-mb',
      '512',
      'prompt two',
    ]);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('PROFILE_LAUNCHER_RAN');
    const out = parseEntryOutput(res.stdout);
    expect(out?.argv).toEqual([
      '--dir',
      'run path',
      '--snapshots',
      '--max-heap-mb',
      '512',
      '--',
      '--provider',
      'fake',
      'prompt one',
      '--model',
      'fake-model',
      'prompt two',
    ]);
  });

  it('preserves the launcher passthrough boundary when no profile options precede it', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_RAN');

    const res = runShim(layout, [
      '--memprofile',
      '--profile-load',
      'installed-profile',
    ]);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(parseEntryOutput(res.stdout)?.argv).toEqual([
      '--',
      '--profile-load',
      'installed-profile',
    ]);
  });

  it('does not activate profiling for --memprofile after a user --', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, defaultEntryBody);

    const res = runShim(layout, ['--', '--memprofile']);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(parseEntryOutput(res.stdout)?.argv).toEqual(['--', '--memprofile']);
  });

  it('leaves memprofile controls after a user -- as ordinary arguments in order', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, defaultEntryBody);
    const args = [
      '--',
      '--memprofile-dir',
      'run path',
      '--memprofile-snapshots',
      '--memprofile-max-heap-mb',
      '512',
    ];

    const res = runShim(layout, args);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(parseEntryOutput(res.stdout)?.argv).toEqual(args);
  });

  it('preserves suffix literals in the launcher passthrough after a prefix activation', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_RAN');

    const res = runShim(layout, [
      '--memprofile',
      '--memprofile-snapshots',
      'prompt',
      '--',
      '--memprofile',
      '--memprofile-max-heap-mb',
      '99',
    ]);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('PROFILE_LAUNCHER_RAN');
    expect(parseEntryOutput(res.stdout)?.argv).toEqual([
      '--snapshots',
      '--',
      'prompt',
      '--',
      '--memprofile',
      '--memprofile-max-heap-mb',
      '99',
    ]);
  });

  it('counts duplicate activation only before the first user --', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_RAN');

    const bare = runShim(layout, ['--memprofile', '--', '--memprofile']);
    expect(bare.status, `stderr: ${bare.stderr}`).toBe(0);
    expect(bare.stdout).toContain('PROFILE_LAUNCHER_RAN');
    expect(parseEntryOutput(bare.stdout)?.argv).toEqual([
      '--',
      '--',
      '--memprofile',
    ]);

    const attached = runShim(layout, [
      '--memprofile',
      '--',
      '--memprofile=5000',
    ]);
    expect(attached.status, `stderr: ${attached.stderr}`).toBe(0);
    expect(attached.stdout).toContain('PROFILE_LAUNCHER_RAN');
    expect(parseEntryOutput(attached.stdout)?.argv).toEqual([
      '--',
      '--',
      '--memprofile=5000',
    ]);

    const duplicate = runShim(layout, ['--memprofile', '--memprofile=1000']);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain('may only be specified once');
    expect(duplicate.stdout).not.toContain('PROFILE_LAUNCHER_RAN');
  });

  it('keeps a user -- after a memprofile utility subcommand in the child argv', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, 'throw new Error("ordinary entry ran");');
    writeProfilerEntry(
      layout.pkgRoot,
      'memprofile-analyze.js',
      'MEMPROFILE_ANALYZE_RAN',
    );

    const res = runShim(layout, [
      'memprofile',
      'analyze',
      'heap.snapshot',
      '--',
      '--verbose',
    ]);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('MEMPROFILE_ANALYZE_RAN');
    expect(parseEntryOutput(res.stdout)?.argv).toEqual([
      'heap.snapshot',
      '--',
      '--verbose',
    ]);
  });

  it('translates an attached interval and accepts the profiler numeric limits', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_RAN');

    const res = runShim(layout, [
      `--memprofile=${MAX_INTERVAL_MS}`,
      '--memprofile-max-heap-mb',
      String(MAX_SNAPSHOT_HEAP_MB_LIMIT),
      '--sandbox',
    ]);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    const out = parseEntryOutput(res.stdout);
    expect(out?.argv).toEqual([
      '--interval',
      String(MAX_INTERVAL_MS),
      '--max-heap-mb',
      String(MAX_SNAPSHOT_HEAP_MB_LIMIT),
      '--',
      '--sandbox',
    ]);
  });

  it('leaves similar activation text and inactive control flags untouched', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, defaultEntryBody);
    const args = [
      '--memprofiled',
      '--memprofile-dir',
      'ordinary path',
      '--memprofile-snapshots',
      '--memprofile-max-heap-mb',
      '12',
    ];

    const res = runShim(layout, args);

    expect(res.status, `stderr: ${res.stderr}`).toBe(0);
    expect(parseEntryOutput(res.stdout)?.argv).toEqual(args);
  });

  const invalidProfileCases: ReadonlyArray<{
    readonly name: string;
    readonly args: readonly string[];
    readonly diagnostic: string;
  }> = [
    {
      name: 'empty attached interval',
      args: ['--memprofile='],
      diagnostic: 'invalid value for --memprofile',
    },
    {
      name: 'duplicate activation',
      args: ['--memprofile', '--memprofile=1000'],
      diagnostic: 'may only be specified once',
    },
    {
      name: 'missing directory',
      args: ['--memprofile', '--memprofile-dir'],
      diagnostic: 'missing value for --memprofile-dir',
    },
    {
      name: 'missing maximum heap',
      args: ['--memprofile', '--memprofile-max-heap-mb'],
      diagnostic: 'missing value for --memprofile-max-heap-mb',
    },
    {
      name: 'zero interval',
      args: ['--memprofile=0'],
      diagnostic: 'positive integer',
    },
    {
      name: 'fractional interval',
      args: ['--memprofile=1.5'],
      diagnostic: 'positive integer',
    },
    {
      name: 'scientific-notation interval',
      args: ['--memprofile=1e3'],
      diagnostic: 'positive integer',
    },
    {
      name: 'hexadecimal interval',
      args: ['--memprofile=0x10'],
      diagnostic: 'positive integer',
    },
    {
      name: 'signed maximum heap',
      args: ['--memprofile', '--memprofile-max-heap-mb', '+5'],
      diagnostic: 'positive integer',
    },
    {
      name: 'duplicate directory control',
      args: [
        '--memprofile',
        '--memprofile-dir',
        'one',
        '--memprofile-dir',
        'two',
      ],
      diagnostic: '--memprofile-dir may only be specified once',
    },
    {
      name: 'duplicate snapshots control',
      args: [
        '--memprofile',
        '--memprofile-snapshots',
        '--memprofile-snapshots',
      ],
      diagnostic: '--memprofile-snapshots may only be specified once',
    },
    {
      name: 'duplicate maximum heap control',
      args: [
        '--memprofile',
        '--memprofile-max-heap-mb',
        '5',
        '--memprofile-max-heap-mb',
        '6',
      ],
      diagnostic: '--memprofile-max-heap-mb may only be specified once',
    },
    {
      name: 'interval above the probe limit',
      args: [`--memprofile=${MAX_INTERVAL_MS + 1}`],
      diagnostic: `must be <= ${MAX_INTERVAL_MS}`,
    },
    {
      name: 'zero maximum heap',
      args: ['--memprofile', '--memprofile-max-heap-mb', '0'],
      diagnostic: 'positive integer',
    },
    {
      name: 'maximum heap above the probe limit',
      args: [
        '--memprofile',
        '--memprofile-max-heap-mb',
        String(MAX_SNAPSHOT_HEAP_MB_LIMIT + 1),
      ],
      diagnostic: `must be <= ${MAX_SNAPSHOT_HEAP_MB_LIMIT}`,
    },
  ];

  for (const invalidCase of invalidProfileCases) {
    it(`rejects ${invalidCase.name} before spawning Bun`, () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_MUST_NOT_RUN');

      const res = runShim(layout, invalidCase.args);

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain(invalidCase.diagnostic);
      expect(res.stderr).toContain('Usage: llxprt');
      expect(res.stdout).not.toContain('PROFILE_LAUNCHER_MUST_NOT_RUN');
    });
  }

  const utilityCases: ReadonlyArray<{
    readonly command: 'request' | 'report' | 'analyze';
    readonly artifact: ProfilerArtifact;
    readonly args: readonly string[];
  }> = [
    {
      command: 'request',
      artifact: 'memprofile-request.js',
      args: ['--heap', '--dir', 'run path'],
    },
    {
      command: 'report',
      artifact: 'memprofile-report.js',
      args: ['samples.jsonl'],
    },
    {
      command: 'analyze',
      artifact: 'memprofile-analyze.js',
      args: ['heap snapshot', '--top', '12'],
    },
  ];

  for (const utilityCase of utilityCases) {
    it(`dispatches memprofile ${utilityCase.command} with remaining argv unchanged`, () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      writeSourceEntry(
        layout.pkgRoot,
        'throw new Error("ordinary entry ran");',
      );
      writeProfilerEntry(
        layout.pkgRoot,
        utilityCase.artifact,
        `MEMPROFILE_${utilityCase.command.toUpperCase()}_RAN`,
      );

      const res = runShim(layout, [
        'memprofile',
        utilityCase.command,
        ...utilityCase.args,
      ]);

      expect(res.status, `stderr: ${res.stderr}`).toBe(0);
      expect(res.stdout).toContain(
        `MEMPROFILE_${utilityCase.command.toUpperCase()}_RAN`,
      );
      expect(parseEntryOutput(res.stdout)?.argv).toEqual(utilityCase.args);
    });
  }

  it('rejects a missing or unknown memprofile utility subcommand with usage', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeSourceEntry(layout.pkgRoot, 'console.log("ORDINARY_MUST_NOT_RUN");');

    const missing = runShim(layout, ['memprofile']);
    const unknown = runShim(layout, ['memprofile', 'unknown']);

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('missing memprofile subcommand');
    expect(missing.stderr).toContain('Usage: llxprt memprofile');
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('unknown memprofile subcommand: unknown');
    expect(unknown.stderr).toContain('Usage: llxprt memprofile');
    expect(missing.stdout + unknown.stdout).not.toContain(
      'ORDINARY_MUST_NOT_RUN',
    );
  });

  for (const missingArtifact of [
    'memprofile-launcher.js',
    'memprofile-preload.js',
    'llxprt.js',
  ] as const) {
    it(`exits 43 before launch when ${missingArtifact} is missing`, () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      writeSourceEntry(layout.pkgRoot, 'console.log("ORDINARY_MUST_NOT_RUN");');
      writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_MUST_NOT_RUN');
      rmSync(path.join(layout.pkgRoot, 'bundle', missingArtifact));

      const res = runShim(layout, ['--memprofile']);

      expect(res.status).toBe(LAUNCHER_FAILURE_EXIT);
      expect(res.stderr).toContain('memory profiler entry point was not found');
      expect(res.stderr).toContain(missingArtifact);
      expect(res.stderr).toContain('reinstall @vybestack/llxprt-code');
      expect(res.stdout).not.toContain('PROFILE_LAUNCHER_MUST_NOT_RUN');
      expect(res.stdout).not.toContain('ORDINARY_MUST_NOT_RUN');
    });
  }

  it('propagates profile and utility child exit statuses', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_RAN');
    writeProfilerEntry(
      layout.pkgRoot,
      'memprofile-report.js',
      'MEMPROFILE_REPORT_RAN',
    );

    const profile = runShim(layout, ['--memprofile'], {
      LLXPRT_TEST_EXIT: '19',
    });
    const utility = runShim(layout, ['memprofile', 'report'], {
      LLXPRT_TEST_EXIT: '23',
    });

    expect(profile.status, `stderr: ${profile.stderr}`).toBe(19);
    expect(utility.status, `stderr: ${utility.stderr}`).toBe(23);
  });

  it.skipIf(isWin)(
    'delivers one SIGINT to a profiled child for one terminal process-group signal',
    async () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      writeProfileLauncher(layout.pkgRoot, 'PROFILE_LAUNCHER_READY');
      const readyPath = path.join(layout.root, 'signal-ready');
      const countPath = path.join(layout.root, 'signal-count');
      writeFileSync(
        path.join(layout.pkgRoot, 'bundle', 'memprofile-launcher.js'),
        [
          'import { writeFileSync } from "node:fs";',
          'if (process.env.LLXPRT_INTERNAL_MEMPROFILE_SIGNAL_BRIDGE !== "1") throw new Error("signal bridge marker missing");',
          'let signalCount = 0;',
          'process.on("SIGINT", () => {',
          '  signalCount++;',
          '  if (signalCount === 1) {',
          `    setTimeout(() => { writeFileSync(${JSON.stringify(countPath)}, String(signalCount)); process.exit(0); }, 250);`,
          '  }',
          '});',
          `writeFileSync(${JSON.stringify(readyPath)}, 'ready');`,
          'setInterval(() => {}, 1000);',
        ].join('\n'),
      );

      const shim = spawn(process.execPath, [layout.shim, '--memprofile'], {
        cwd: layout.root,
        detached: true,
        env: { ...process.env },
        stdio: 'ignore',
      });
      if (shim.pid === undefined) {
        throw new Error('profile shim did not expose a pid');
      }
      const deadline = Date.now() + 10_000;
      while (!existsSync(readyPath)) {
        if (Date.now() >= deadline) {
          process.kill(-shim.pid, 'SIGKILL');
          throw new Error('timed out waiting for profiled child startup');
        }
        await Bun.sleep(25);
      }

      process.kill(-shim.pid, 'SIGINT');
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          process.kill(-shim.pid, 'SIGKILL');
          reject(new Error('profile shim did not exit after SIGINT'));
        }, 10_000);
        shim.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        shim.once('exit', (code, signal) => {
          clearTimeout(timeout);
          resolvePromise({ code, signal });
        });
      });

      expect(result).toEqual({ code: 0, signal: null });
      expect(readFileSync(countPath, 'utf8')).toBe('1');
    },
    15_000,
  );
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
function quoteForBash(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function runShimWithOpenFd3(
  layout: Layout,
  args: readonly string[] = [],
  extraEnv: Record<string, string> = {},
): RunResult & { readonly tokenIno: string } {
  const tokenFile = path.join(layout.root, 'capability-token');
  const stdoutPath = path.join(layout.root, 'fd3-stdout.log');
  const stderrPath = path.join(layout.root, 'fd3-stderr.log');
  writeFileSync(tokenFile, `${CAPABILITY_TOKEN}\n`);
  writeFileSync(stdoutPath, '');
  writeFileSync(stderrPath, '');
  const quotedArgs = args.map(quoteForBash).join(' ');
  const script =
    `exec 1>${quoteForBash(stdoutPath)}\n` +
    `exec 2>${quoteForBash(stderrPath)}\n` +
    `exec 3<${quoteForBash(tokenFile)}\n` +
    `exec node ${quoteForBash(layout.shim)}${quotedArgs === '' ? '' : ` ${quotedArgs}`}`;
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    cwd: layout.root,
    timeout: LAUNCH_TIMEOUT_MS,
    env: { ...process.env, ...extraEnv },
    stdio: 'ignore',
  });
  return {
    status: result.status,
    stdout: readCapture(stdoutPath),
    stderr: readCapture(stderrPath, result.error),
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

      const res = runShimWithOpenFd3(layout, [], { LLXPRT_CAPABILITY_FD: '3' });

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

      const res = runShimWithOpenFd3(layout, [], { LLXPRT_CAPABILITY_FD: '4' });

      expect(res.status).toBe(LAUNCHER_FAILURE_EXIT);
      expect(res.stderr).toContain('LLXPRT_CAPABILITY_FD');
      expect(res.stdout).not.toContain('CLI_RAN');
    },
  );

  it.skipIf(isWin)(
    'forwards descriptor 3 unchanged to a selected profile launcher',
    () => {
      const layout = makeLayout(tempDir);
      placeBundledBun(layout.nodeModules);
      const bundleDir = path.join(layout.pkgRoot, 'bundle');
      mkdirSync(bundleDir, { recursive: true });
      writeFileSync(
        path.join(bundleDir, 'memprofile-launcher.js'),
        capabilityEntryBody,
      );
      writeFileSync(path.join(bundleDir, 'memprofile-preload.js'), '');
      writeBundleEntry(layout.pkgRoot, '');

      const res = runShimWithOpenFd3(layout, ['--memprofile'], {
        LLXPRT_CAPABILITY_FD: '3',
      });

      expect(res.status, `stderr: ${res.stderr}`).toBe(0);
      const out = parseCapabilityOutput(res.stdout);
      expect(out?.marker).toBe('3');
      expect(out?.ino).toBe(res.tokenIno);
      expect(out?.raw).toBe(`${CAPABILITY_TOKEN}\n`);
    },
  );
});
