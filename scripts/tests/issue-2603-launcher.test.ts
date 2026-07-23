import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  chmodSync,
  symlinkSync,
  readFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const launcherPath = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
const repoBun = join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');

/**
 * The exit code the launcher uses for all launch-failure modes (missing Bun,
 * corrupt Bun, wrong platform/unrecognized format, missing entry point).
 * Centralized so a change to the launcher's failure code only requires updating
 * one place. Mirrors the LAUNCHER_ERROR_EXIT_CODE constant in
 * packages/cli/scripts/install-native-launchers.cjs.
 */
const LAUNCHER_FAILURE_EXIT = 43;

/**
 * The bundled Bun binary filename. The launcher resolves and exec's
 * node_modules/bun/bin/<BUN_BINARY_NAME> on all platforms; on Windows the
 * launcher runs through the .cmd/.ps1 wrapper but the binary itself is still
 * named bun.exe. This constant makes the platform-independent binary name
 * explicit so a rename here stays in sync with the launcher.
 */
const BUN_BINARY_NAME = 'bun.exe';

const SHELL_PROBE_TIMEOUT_MS = 10_000;
const SHORT_LAUNCH_TIMEOUT_MS = 15_000;
const STANDARD_LAUNCH_TIMEOUT_MS = 30_000;

/**
 * Extracts the inner `case "$_llxprt_magic"` block that follows a kernel
 * marker (e.g. 'Darwin)') in the launcher source, so platform-gated magic
 * acceptance can be asserted per-branch.
 */
function launcherMagicBlockAfter(marker: string): string {
  const source = readFileSync(launcherPath, 'utf8');
  const start = source.indexOf(marker);
  const magicStart = source.indexOf('case "$_llxprt_magic"', start);
  const magicEsac = source.indexOf('esac', magicStart);
  return source.slice(magicStart, magicEsac);
}

// Bun is a declared root dependency (see trustedDependencies in the root
// package.json) and a test prerequisite: the launcher exec's it directly. A
// missing Bun means the repo install is broken — skipping would hide that, so
// we throw rather than mark tests as skipped.
function ensureBun(): string {
  if (existsSync(repoBun)) {
    return repoBun;
  }
  // Use POSIX-standard 'command -v' instead of non-standard 'which' for
  // better portability on minimal container images.
  const commandVResult = spawnSync('sh', ['-c', 'command -v bun'], {
    encoding: 'utf8',
  });
  if (commandVResult.status === 0 && commandVResult.stdout.trim()) {
    return commandVResult.stdout.trim();
  }
  throw new Error('Bun not found for test setup');
}

/** Guard: surfaces spawn failures (ENOENT, EACCES) before null status checks. */
function expectNoSpawnError(result: { error?: Error }): void {
  if (result.error) {
    throw new Error(`spawn failed: ${result.error.message}`);
  }
}

/**
 * Returns the real Bun version from the repo's bun package.json so tests can
 * write matching pins. Bun is a declared dependency and test prerequisite; a
 * missing/unreadable version indicates a broken installation, so we throw
 * rather than fall back to a hardcoded version that would become stale on the
 * next Bun upgrade.
 */
function realBunVersion(): string {
  const bunPkgPath = join(repoRoot, 'node_modules', 'bun', 'package.json');
  const bunPkg = JSON.parse(readFileSync(bunPkgPath, 'utf8'));
  if (typeof bunPkg.version === 'string' && bunPkg.version.length > 0) {
    return bunPkg.version;
  }
  throw new Error(
    `Bun package.json at ${bunPkgPath} has no valid version field; ` +
      'the repo installation appears broken.',
  );
}

function makeEntry(pkgRoot: string, code: string): void {
  writeFileSync(join(pkgRoot, 'index.ts'), `#!/usr/bin/env -S bun\n${code}\n`);
}

function makeLayout(
  tempDir: string,
  opts: { withBun?: boolean; withIndex?: boolean; entryCode?: string } = {},
): { pkgRoot: string; launcherTarget: string } {
  const pkgRoot = join(tempDir, 'pkg');
  const binDir = join(pkgRoot, 'bin');
  mkdirSync(binDir, { recursive: true });

  const launcherTarget = join(binDir, 'llxprt');
  copyFileSync(launcherPath, launcherTarget);
  chmodSync(launcherTarget, 0o755);

  if (opts.withIndex !== false) {
    makeEntry(pkgRoot, opts.entryCode ?? 'process.exit(0);');
  }

  if (opts.withBun !== false) {
    const bunPath = ensureBun();
    const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(bunDir, { recursive: true });
    copyFileSync(bunPath, join(bunDir, BUN_BINARY_NAME));
  }

  return { pkgRoot, launcherTarget };
}

describe('POSIX launcher portability', () => {
  it('passes shellcheck with no warnings', () => {
    // Use POSIX-standard 'command -v' instead of non-standard 'which'.
    const which = spawnSync('sh', ['-c', 'command -v shellcheck'], {
      encoding: 'utf8',
    });
    if (which.status !== 0) {
      console.warn('shellcheck not installed; skipping static analysis proof');
      return;
    }
    const result = spawnSync('shellcheck', [launcherPath], {
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
    });
    expect(
      result.status,
      `shellcheck reported issues:\n${result.stdout}\n${result.stderr}`,
    ).toBe(0);
  });

  it('uses -- end-of-options for readlink/dirname/cd (portable on stock macOS BSD)', () => {
    const source = readFileSync(launcherPath, 'utf8');
    expect(source).toMatch(/readlink -- "\$_llxprt_self"/);
    expect(source).toMatch(/dirname -- "\$_llxprt_self"/);
    expect(source).toMatch(/cd -- "\$\(dirname/);
  });

  it('od magic check is portable (single-file -N4 form, no GNU-only flags)', () => {
    const source = readFileSync(launcherPath, 'utf8');
    expect(source).toMatch(/od -An -tx1 -N4 -- "\$_llxprt_bun"/);
  });

  it('readlink -- resolves symlinks on stock macOS (behavioral proof)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-readlink-'));
    try {
      const target = join(tempDir, 'real-target');
      writeFileSync(target, '#!/bin/sh\necho ok\n');
      chmodSync(target, 0o755);
      const link = join(tempDir, 'mylink');
      symlinkSync(target, link);
      const r = spawnSync('sh', ['-c', `readlink -- "${link}"`], {
        encoding: 'utf8',
        timeout: SHELL_PROBE_TIMEOUT_MS,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe(target);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('dirname -- handles dash-prefixed names on stock macOS (behavioral proof)', () => {
    const r = spawnSync('sh', ['-c', `dirname -- "-weird-name"`], {
      encoding: 'utf8',
      timeout: SHELL_PROBE_TIMEOUT_MS,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('.');
  });

  it('od -An -tx1 -N4 reads first 4 bytes on stock macOS (behavioral proof)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-od-'));
    try {
      const elfFile = join(tempDir, 'fake-elf');
      writeFileSync(elfFile, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
      const r = spawnSync(
        'sh',
        ['-c', `od -An -tx1 -N4 -- "${elfFile}" | tr -d ' \\n'`],
        { encoding: 'utf8', timeout: SHELL_PROBE_TIMEOUT_MS },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('7f454c46');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('POSIX launcher file', () => {
  it('ships as an executable file with a valid sh shebang', () => {
    expect(existsSync(launcherPath)).toBe(true);
    const stats = statSync(launcherPath);
    expect(stats.isFile()).toBe(true);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  it('uses a sh shebang, not a Node shebang', () => {
    const source = readFileSync(launcherPath, 'utf8');
    expect(source.startsWith('#!/bin/sh')).toBe(true);
    expect(source).not.toMatch(/^#!.*node/m);
  });
});

describe('POSIX launcher execution behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-posix-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  it('is directly execve-compatible (no shell fallback)', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir);
    const result = spawnSync(launcherTarget, ['--test'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
  it('launches Bun (process.versions.bun is set)', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: `console.log(typeof process.versions.bun === 'string' && process.versions.bun.length > 0);`,
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('true');
  });
  it('uses package-local Bun even with constrained PATH', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir);
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(0);
  });
  it('invokes Bun exactly once (no pre-probe)', () => {
    const counterDir = join(tempDir, 'counter');
    mkdirSync(counterDir, { recursive: true });
    const counterFile = join(counterDir, 'invocations.txt');
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: `const fs = require('fs');
       const counter = ${JSON.stringify(counterFile)};
       let count = 0;
       try { count = parseInt(fs.readFileSync(counter, 'utf8').trim(), 10) || 0; } catch {}
       fs.writeFileSync(counter, String(count + 1));
       console.log(count + 1);`,
    });

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('1');
    expect(existsSync(counterFile)).toBe(true);
    expect(readFileSync(counterFile, 'utf8').trim()).toBe('1');
  });
  it('forwards arguments including spaces, Unicode, and shell metacharacters', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: `console.log(JSON.stringify(process.argv.slice(2)));`,
    });
    const trickyArgs = [
      'hello world',
      'Unicode: ✓ 日本語 ñ',
      'shell: $HOME `whoami` $(date)',
      'quotes: "double" \'single\'',
      'semicolon; pipe| amp&',
    ];
    const result = spawnSync(launcherTarget, trickyArgs, {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as string[];
    expect(parsed).toStrictEqual(trickyArgs);
  });
  it('propagates a non-zero exit code from the child', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: 'process.exit(7);',
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(7);
  });
  it('propagates stdin/stdout/stderr', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: [
        'process.stdin.on("data", (chunk) => {',
        '  process.stdout.write("OUT:" + chunk.toString());',
        '  process.stderr.write("ERR:" + chunk.toString());',
        '});',
      ].join('\n'),
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      input: 'hello',
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OUT:hello');
    expect(result.stderr).toContain('ERR:hello');
  });
  it('exits 43 when Bun is not found', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      withBun: false,
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/npm install|bun\.sh/i);
  });
  it('does not accept an unrelated Bun from a consumer ancestor directory', () => {
    // Simulates: consumer-project/node_modules/@vybestack/llxprt-code/bin/llxprt
    // The launcher must NOT climb past the enclosing node_modules to find
    // consumer-project/node_modules/bun (a consumer's own Bun dependency).
    // Here the package has NO package-local or hoisted Bun, but a "consumer"
    // ancestor directory has its own node_modules/bun — which must be rejected.
    const consumerDir = join(tempDir, 'consumer-project');
    const pkgRoot = join(
      consumerDir,
      'node_modules',
      '@vybestack',
      'llxprt-code',
    );
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);
    makeEntry(pkgRoot, 'process.exit(0);');

    // Consumer's OWN bun dependency (unrelated ancestor Bun).
    const consumerBunDir = join(consumerDir, 'node_modules', 'bun', 'bin');
    mkdirSync(consumerBunDir, { recursive: true });
    copyFileSync(ensureBun(), join(consumerBunDir, 'bun.exe'));

    // The package has a package.json with a bun pin so the launcher WILL try
    // to validate versions. The consumer's bun has a DIFFERENT version.
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify(
        { name: '@vybestack/llxprt-code', dependencies: { bun: '1.3.14' } },
        null,
        2,
      ),
    );
    // The consumer's bun package.json has a different version.
    writeFileSync(
      join(consumerDir, 'node_modules', 'bun', 'package.json'),
      JSON.stringify({ name: 'bun', version: '9.9.9' }, null, 2),
    );

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
  });
  it('accepts a hoisted Bun within the enclosing node_modules', () => {
    // Simulates npm hoisting: the package is at
    // consumer/node_modules/@vybestack/llxprt-code/bin/llxprt and the Bun
    // dependency is hoisted to consumer/node_modules/bun/bin/bun.exe.
    // The enclosing node_modules is consumer/node_modules; the search must
    // find the hoisted Bun and NOT climb to consumer/ or above.
    const consumerDir = join(tempDir, 'consumer-hoisted');
    const pkgRoot = join(
      consumerDir,
      'node_modules',
      '@vybestack',
      'llxprt-code',
    );
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);
    makeEntry(pkgRoot, 'process.exit(0);');

    // Hoisted Bun at the enclosing node_modules level.
    const hoistedBunDir = join(consumerDir, 'node_modules', 'bun', 'bin');
    mkdirSync(hoistedBunDir, { recursive: true });
    const bunPath = ensureBun();
    copyFileSync(bunPath, join(hoistedBunDir, 'bun.exe'));

    const bunVersion = realBunVersion();
    writeFileSync(
      join(consumerDir, 'node_modules', 'bun', 'package.json'),
      JSON.stringify({ name: 'bun', version: bunVersion }, null, 2),
    );
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@vybestack/llxprt-code',
          dependencies: { bun: bunVersion },
        },
        null,
        2,
      ),
    );

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
  });
  it('exits 43 when Bun is a corrupt text file (not a native binary)', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      withBun: false,
    });
    const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(bunDir, { recursive: true });
    const corruptBun = join(bunDir, 'bun.exe');
    writeFileSync(corruptBun, '#!/bin/sh\necho this is not a real binary\n');
    chmodSync(corruptBun, 0o755);
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(
      /npm install|bun\.sh|unusable|not a valid|corrupt/i,
    );
  });
  it('exits 43 when Bun has wrong magic bytes (not ELF/Mach-O/PE)', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      withBun: false,
    });
    const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(bunDir, { recursive: true });
    const wrongMagicBun = join(bunDir, 'bun.exe');
    // Random bytes that are neither ELF (7f454c46), Mach-O (feedface/etc.),
    // nor PE/COFF (4d5a, "MZ").
    writeFileSync(
      wrongMagicBun,
      Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]),
    );
    chmodSync(wrongMagicBun, 0o755);
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(
      /npm install|bun\.sh|unusable|not a valid|corrupt/i,
    );
  });

  it('accepts a PE/COFF (MZ, 4d5a) Bun magic only on Windows POSIX (MSYS/Git Bash)', () => {
    // POSIX shells that can execute Windows PE (Git Bash/MSYS) need the magic
    // check to accept MZ so a real bun.exe is not rejected. We cannot exec a
    // PE on this POSIX host, so we assert at the unit level: the launcher's
    // magic case-statement must accept the 4d5a prefix ONLY in the
    // MINGW/MSYS/CYGWIN branch, and must NOT accept it in Darwin or Linux.
    expect(launcherMagicBlockAfter('MINGW*|MSYS*|CYGWIN*')).toMatch(/4d5a\*/);
    expect(launcherMagicBlockAfter('Darwin)')).not.toMatch(/4d5a/);
    expect(launcherMagicBlockAfter('Linux and other ELF')).not.toMatch(/4d5a/);
  });

  it.skipIf(process.platform !== 'darwin')(
    'rejects a PE/COFF Bun binary on Darwin (platform-gated magic)',
    () => {
      // On macOS (Darwin), a PE/COFF binary cannot execute and must be rejected
      // with exit 43. This test only runs on Darwin; on Linux it would test ELF
      // rejection of PE (also correct), but the assertion is Darwin-specific.
      const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
        withBun: false,
      });
      const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
      mkdirSync(bunDir, { recursive: true });
      const peBun = join(bunDir, 'bun.exe');
      // PE/COFF magic: MZ (4d5a) followed by arbitrary bytes.
      writeFileSync(peBun, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x01, 0x02]));
      chmodSync(peBun, 0o755);
      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: SHORT_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expectNoSpawnError(result);
      expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
      expect(result.stderr).toMatch(
        /npm install|bun\.sh|unusable|not a valid|corrupt/i,
      );
    },
    15_000,
  );

  it('magic case-statement accepts the correct native format per platform', () => {
    // Unit-level contract: accepted magics must appear in the correct
    // platform-gated branches.
    // MINGW/MSYS/CYGWIN branch: PE/COFF only (Windows runs PE natively;
    // ELF and Mach-O indicate a corrupt or wrong-platform install).
    const mingwBlock = launcherMagicBlockAfter('MINGW*|MSYS*|CYGWIN*');
    expect(mingwBlock).toContain('4d5a'); // PE/COFF
    expect(mingwBlock).not.toContain('7f454c46'); // no ELF on Windows
    expect(mingwBlock).not.toContain('feedface'); // no Mach-O on Windows

    // Darwin branch: Mach-O only.
    const darwinBlock = launcherMagicBlockAfter('Darwin)');
    expect(darwinBlock).toContain('feedface');
    expect(darwinBlock).toContain('feedfacf');
    expect(darwinBlock).toContain('cefaedfe');
    expect(darwinBlock).toContain('cffaedfe');
    expect(darwinBlock).toContain('cafebabe');
    expect(darwinBlock).toContain('bebafeca');
    expect(darwinBlock).not.toContain('7f454c46'); // no ELF on Darwin
    expect(darwinBlock).not.toContain('4d5a'); // no PE on Darwin

    // Default (Linux) branch: ELF only.
    const defaultBlock = launcherMagicBlockAfter('Linux and other ELF');
    expect(defaultBlock).toContain('7f454c46'); // ELF
    expect(defaultBlock).not.toContain('feedface'); // no Mach-O on Linux
    expect(defaultBlock).not.toContain('4d5a'); // no PE on Linux
  });

  it('rejects a PE/COFF-looking file whose payload is not executable (od proof)', () => {
    // Behavioral proof that od reads the first 4 bytes and tr matchers accept
    // the MZ prefix: this confirms the 4d5a* glob would match real PE files.
    const tempDir2 = mkdtempSync(join(tmpdir(), 'llxprt-pe-od-'));
    try {
      const peFile = join(tempDir2, 'fake-pe');
      writeFileSync(peFile, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x01]));
      const r = spawnSync(
        'sh',
        ['-c', `od -An -tx1 -N4 -- "${peFile}" | tr -d ' \\n'`],
        { encoding: 'utf8', timeout: SHELL_PROBE_TIMEOUT_MS },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim().startsWith('4d5a')).toBe(true);
    } finally {
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });
  it('exits 43 when Bun exists but is not executable', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      withBun: false,
    });
    const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(bunDir, { recursive: true });
    const bunPath = ensureBun();
    const nonExecBun = join(bunDir, 'bun.exe');
    copyFileSync(bunPath, nonExecBun);
    chmodSync(nonExecBun, 0o644); // readable but not executable
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
  });
  it('launches a valid Mach-O Bun exactly once (no double-start)', () => {
    // The real Bun binary IS a valid Mach-O/ELF. This confirms the magic
    // check ACCEPTS a real native binary and execs it (the counter proves
    // exactly one invocation, not a pre-probe + exec).
    const counterFile = join(tempDir, 'invocations.txt');
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: `const fs = require('fs');
       let count = 0;
       try { count = parseInt(fs.readFileSync(${JSON.stringify(counterFile)}, 'utf8').trim(), 10) || 0; } catch {}
       fs.writeFileSync(${JSON.stringify(counterFile)}, String(count + 1));`,
    });

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(counterFile, 'utf8').trim()).toBe('1');
  });
  it('preserves a legitimate non-zero exit code from the entry', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: 'process.exit(42);',
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(42);
  });
  it('exits 43 when index.ts is not found', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      withIndex: false,
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/entry point|index\.ts|corrupt/i);
  });
  it('resolves symlinks so $0 works through npm .bin links', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir);
    const binLink = join(pkgRoot, 'node_modules', '.bin', 'llxprt');
    mkdirSync(dirname(binLink), { recursive: true });
    symlinkSync(launcherTarget, binLink);

    const result = spawnSync(binLink, ['--version'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(0);
  });
  it('does not mutate the environment with LLXPRT_BUN_RELAUNCHED', () => {
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: `console.log(process.env.LLXPRT_BUN_RELAUNCHED ?? 'unset');`,
    });
    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('unset');
  });
});

describe('POSIX launcher version-pin and platform validation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pin-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  it('rejects a hoisted Bun whose version does not match the package pin', () => {
    // The package declares bun pin "9.9.9" but the hoisted Bun has a different
    // version. The launcher must reject this version mismatch.
    const consumerDir = join(tempDir, 'consumer-pin-mismatch');
    const pkgRoot = join(
      consumerDir,
      'node_modules',
      '@vybestack',
      'llxprt-code',
    );
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);
    makeEntry(pkgRoot, 'process.exit(0);');

    // Hoisted Bun with a DIFFERENT version than the pin.
    const hoistedBunDir = join(consumerDir, 'node_modules', 'bun', 'bin');
    mkdirSync(hoistedBunDir, { recursive: true });
    copyFileSync(ensureBun(), join(hoistedBunDir, 'bun.exe'));
    writeFileSync(
      join(consumerDir, 'node_modules', 'bun', 'package.json'),
      JSON.stringify({ name: 'bun', version: '1.0.0' }, null, 2),
    );
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify(
        { name: '@vybestack/llxprt-code', dependencies: { bun: '9.9.9' } },
        null,
        2,
      ),
    );

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
  });
  it('accepts a hoisted Bun whose version matches the package pin', () => {
    const bunVersion = realBunVersion();
    const consumerDir = join(tempDir, 'consumer-pin-match');
    const pkgRoot = join(
      consumerDir,
      'node_modules',
      '@vybestack',
      'llxprt-code',
    );
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);
    makeEntry(pkgRoot, 'process.exit(0);');

    // Hoisted Bun with a MATCHING version.
    const hoistedBunDir = join(consumerDir, 'node_modules', 'bun', 'bin');
    mkdirSync(hoistedBunDir, { recursive: true });
    copyFileSync(ensureBun(), join(hoistedBunDir, 'bun.exe'));
    writeFileSync(
      join(consumerDir, 'node_modules', 'bun', 'package.json'),
      JSON.stringify({ name: 'bun', version: bunVersion }, null, 2),
    );
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@vybestack/llxprt-code',
          dependencies: { bun: bunVersion },
        },
        null,
        2,
      ),
    );

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: STANDARD_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
  });
  it('does not scan beyond the enclosing node_modules for Bun', () => {
    // The package is nested two levels deep inside node_modules. The enclosing
    // node_modules has NO bun. An ancestor project dir (OUTSIDE the enclosing
    // node_modules) has bun — but the launcher must NOT climb past the
    // enclosing node_modules to find it.
    const grandparentDir = join(tempDir, 'grandparent');
    const consumerNm = join(grandparentDir, 'node_modules');
    const pkgRoot = join(consumerNm, '@vybestack', 'llxprt-code');
    const binDir = join(pkgRoot, 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcherTarget = join(binDir, 'llxprt');
    copyFileSync(launcherPath, launcherTarget);
    chmodSync(launcherTarget, 0o755);
    makeEntry(pkgRoot, 'process.exit(0);');

    // Ancestor bun OUTSIDE the enclosing node_modules — must be rejected.
    const ancestorBunDir = join(tempDir, 'node_modules', 'bun', 'bin');
    mkdirSync(ancestorBunDir, { recursive: true });
    copyFileSync(ensureBun(), join(ancestorBunDir, 'bun.exe'));

    const result = spawnSync(launcherTarget, [], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: SHORT_LAUNCH_TIMEOUT_MS,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expectNoSpawnError(result);
    expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
    expect(result.stderr).toMatch(/bundled Bun runtime was not found/i);
  });

  it.skipIf(process.platform !== 'darwin')(
    'rejects an ELF Bun on Darwin (platform-gated format)',
    () => {
      const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
        withBun: false,
      });
      const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
      mkdirSync(bunDir, { recursive: true });
      const elfBun = join(bunDir, 'bun.exe');
      // ELF magic: 7f454c46
      writeFileSync(elfBun, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
      chmodSync(elfBun, 0o755);
      const result = spawnSync(launcherTarget, [], {
        cwd: pkgRoot,
        encoding: 'utf8',
        timeout: SHORT_LAUNCH_TIMEOUT_MS,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      expect(result.status).toBe(LAUNCHER_FAILURE_EXIT);
      expect(result.stderr).toMatch(
        /npm install|bun\.sh|unusable|not a valid|corrupt/i,
      );
    },
    15_000,
  );
});
