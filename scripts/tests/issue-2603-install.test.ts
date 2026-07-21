import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const nodeRequire = createRequire(import.meta.url);
const cliModulePath = join(
  repoRoot,
  'packages',
  'cli',
  'scripts',
  'install-native-launchers.cjs',
);

function loadCliInstaller(): ReturnType<typeof nodeRequire> {
  // Always require a fresh module instance so a previous test's cached state
  // (e.g. resolved paths) cannot leak across runs. The module is stateless
  // aside from its exported functions, but deleting the cache entry prevents
  // any future module-level mutation from causing stale behavior.
  delete nodeRequire.cache[cliModulePath];
  return nodeRequire(cliModulePath);
}

/**
 * Per-process cache dir keyed by the CLI manifest fingerprint so concurrent
 * test runs do not corrupt a shared cache. The fingerprint is derived from the
 * package name + version + mtime, matching the release-pack helper's strategy.
 */
function cliManifestFingerprint(): string {
  const cliPkgPath = join(repoRoot, 'packages', 'cli', 'package.json');
  let mtime = 0;
  try {
    mtime = statSync(cliPkgPath).mtimeMs;
  } catch {
    // stat failure is non-fatal.
  }
  return String(mtime).replace(/[^0-9]/g, '0');
}

const sharedCacheDir = join(
  tmpdir(),
  `llxprt-2603-cache-${process.pid}-${cliManifestFingerprint()}`,
);
let cachedTarball: string | null = null;

/**
 * Cross-platform npm discovery. On Windows `which` does not exist, so use
 * `where`. Prefer process.execPath / npm_execpath when available to avoid
 * spawning an extra process. Returns the npm binary path.
 */
function resolveNpm(): string {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return process.execPath;
  }
  return 'npm';
}

function findTarballName(packOutput: string): string {
  const lines = packOutput.split(/\r?\n/);
  const tgzLines = lines.filter((l) => l.trim().endsWith('.tgz'));
  if (tgzLines.length === 0) {
    throw new Error(
      `npm pack output did not contain a .tgz line:\n${packOutput}`,
    );
  }
  return tgzLines[tgzLines.length - 1].trim();
}

function packCliWorkspace(): string {
  if (cachedTarball && existsSync(cachedTarball)) {
    return cachedTarball;
  }
  mkdirSync(sharedCacheDir, { recursive: true });
  const npmBin = resolveNpm();
  const npmArgs =
    npmBin === process.execPath
      ? [
          process.env.npm_execpath!,
          'pack',
          '-w',
          '@vybestack/llxprt-code',
          '--pack-destination',
          sharedCacheDir,
        ]
      : [
          'pack',
          '-w',
          '@vybestack/llxprt-code',
          '--pack-destination',
          sharedCacheDir,
        ];
  const result = spawnSync(npmBin, npmArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error) {
    throw new Error(`npm pack -w spawn failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `npm pack -w failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr}`,
    );
  }
  const tarballName = findTarballName(result.stdout);
  cachedTarball = join(sharedCacheDir, tarballName);
  return cachedTarball;
}

/**
 * Spawns tar with spawn-error diagnostics. GitHub Windows runners ship
 * bsdtar; a spawn failure (ENOENT) produces a clear diagnostic rather than an
 * opaque null status.
 */
function spawnTarList(tarball: string): { stdout: string } {
  const result = spawnSync('tar', ['-tzf', tarball], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is it on PATH? GitHub Windows has bsdtar): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `tar list failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
    );
  }
  return { stdout: result.stdout };
}

function spawnTarListVerbose(
  tarball: string,
  member: string,
): { stdout: string } {
  const result = spawnSync('tar', ['-tzvf', tarball, member], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is it on PATH? GitHub Windows has bsdtar): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `tar list-verbose failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
    );
  }
  return { stdout: result.stdout };
}

describe('CLI workspace tarball contents (actual release artifact)', () => {
  it('includes the POSIX launcher at bin/llxprt', () => {
    const tarball = packCliWorkspace();
    expect(existsSync(tarball)).toBe(true);
    const { stdout } = spawnTarList(tarball);
    const files = stdout.split('\n');
    expect(files).toContain('package/bin/llxprt');
    expect(files).toContain('package/index.ts');
    expect(files).toContain('package/package.json');
  }, 120_000);

  it('includes the installer script', () => {
    const tarball = packCliWorkspace();
    const { stdout } = spawnTarList(tarball);
    const files = stdout.split('\n');
    expect(files).toContain('package/scripts/install-native-launchers.cjs');
  }, 120_000);

  it('does NOT include the old Node launcher (llxprt.cjs)', () => {
    const tarball = packCliWorkspace();
    const { stdout } = spawnTarList(tarball);
    const files = stdout.split('\n');
    expect(files.some((f) => f.endsWith('.cjs') && f.includes('bin/'))).toBe(
      false,
    );
  }, 120_000);

  it('declares a postinstall script in the CLI workspace package.json', () => {
    const cliPkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string>; bin: Record<string, string> };
    expect(cliPkg.scripts.postinstall).toContain('install-native-launchers');
    expect(cliPkg.bin.llxprt).toBe('bin/llxprt');
  });

  it('ships bin/llxprt with executable mode in the tarball', () => {
    const tarball = packCliWorkspace();
    const { stdout } = spawnTarListVerbose(tarball, 'package/bin/llxprt');
    expect(stdout).toMatch(/^[^ ]*x/);
  }, 120_000);
});

describe('install-native-launchers module (CLI workspace)', () => {
  describe('cmd launcher generation', () => {
    it('generates a cmd with no delayed expansion', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      expect(cmd).not.toMatch(/enableDelayedExpansion/i);
    });

    it('embeds the ownership sentinel', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      expect(cmd).toContain(mod.OWNERSHIP_SENTINEL);
    });

    it('directly invokes bun.exe with %* using %~dp0 prefix', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      expect(cmd).toMatch(/"%~dp0bun\.exe" "%~dp0index\.ts" %\*/);
    });

    it('exits with code 43 on missing Bun', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      expect(cmd).toContain('exit /b 43');
      expect(cmd).toMatch(/npm install|bun\.sh/i);
    });

    it('does not set LLXPRT_BUN_RELAUNCHED', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      expect(cmd).not.toMatch(/LLXPRT_BUN_RELAUNCHED/i);
    });
  });

  describe('PowerShell launcher generation', () => {
    it('uses an argument array and propagates LASTEXITCODE', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('bun.exe', 'index.ts');
      expect(ps1).toContain('$allArgs = @($entry) + $args');
      expect(ps1).toContain('exit $LASTEXITCODE');
    });

    it('supports pipeline input', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('bun.exe', 'index.ts');
      expect(ps1).toContain('ExpectingInput');
      expect(ps1).toContain('$input | & $bunExe');
    });

    it('embeds the ownership sentinel', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('bun.exe', 'index.ts');
      expect(ps1).toContain(mod.OWNERSHIP_SENTINEL);
    });

    it('exits with code 43 on missing Bun', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('bun.exe', 'index.ts');
      expect(ps1).toContain('exit 43');
    });

    it('does not set LLXPRT_BUN_RELAUNCHED', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('bun.exe', 'index.ts');
      expect(ps1).not.toMatch(/LLXPRT_BUN_RELAUNCHED/i);
    });

    it('uses forward-slash relative paths for Join-Path', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('sub/bun.exe', 'index.ts');
      expect(ps1).toContain("Join-Path $basedir 'sub/bun.exe'");
    });
  });

  describe('ownership guard with real npm cmd-shim grammar', () => {
    function resolveCmdShimPath(): string {
      const candidates = [
        '/opt/homebrew/lib/node_modules/npm/node_modules/cmd-shim',
        join(process.env.HOME ?? '/root', '.nvm/versions/node', 'npm'),
        join(repoRoot, 'node_modules', 'cmd-shim'),
      ];
      for (const candidate of candidates) {
        try {
          nodeRequire.resolve(candidate);
          return candidate;
        } catch {
          // try next
        }
      }
      const npmRoot = spawnSync('npm', ['root', '-g'], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      if (npmRoot.status === 0) {
        const globalRoot = npmRoot.stdout.trim();
        const candidate = join(globalRoot, 'npm', 'node_modules', 'cmd-shim');
        try {
          nodeRequire.resolve(candidate);
          return candidate;
        } catch {
          // try npm's own location
        }
      }
      // Cross-platform npm discovery: `which` does not exist on Windows.
      // Use `where` on win32, or prefer process.execPath / npm_execpath when
      // available to avoid spawning an extra process.
      const npmExecPath = process.env.npm_execpath;
      let npmDir: string | null = null;
      if (npmExecPath) {
        // npm_execpath is the CLI script path; npm lives in its parent dir.
        npmDir = dirname(dirname(npmExecPath));
      } else {
        const tool = process.platform === 'win32' ? 'where' : 'which';
        const npmCli = spawnSync(tool, ['npm'], { encoding: 'utf8' });
        if (npmCli.error) {
          // spawn error (e.g. tool not installed); fall through to throw.
        } else if (npmCli.status === 0) {
          const lines = npmCli.stdout.trim().split(String.fromCharCode(10));
          const npmBin = dirname(lines[0]!);
          npmDir = dirname(npmBin);
        }
      }
      if (npmDir) {
        const candidate = join(npmDir, 'node_modules', 'cmd-shim');
        try {
          nodeRequire.resolve(candidate);
          return candidate;
        } catch {
          // not there
        }
      }
      throw new Error('cmd-shim not found');
    }

    function generateRealCmdShim(binLinkDir: string, target: string): string {
      const cmdShimPath = resolveCmdShimPath();
      // Use the ACTUAL POSIX launcher (with its #!/bin/sh shebang) as the
      // target. This is what npm cmd-shim sees in a real install: a shebanged
      // script, which causes cmd-shim to emit an interpreter-first wrapper
      // (referencing /bin/sh.exe AND the package target). Using a placeholder
      // target without a shebang would only exercise the non-interpreter path
      // and hide the parser bug where the first %dp0% reference is the
      // interpreter, not the package target.
      const launcherSource = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
      const result = spawnSync(
        'node',
        [
          '-e',
          [
            'const cmdShim = require(' + JSON.stringify(cmdShimPath) + ');',
            'const fs = require("fs");',
            'const path = require("path");',
            'const target = ' + JSON.stringify(target) + ';',
            'const link = ' + JSON.stringify(join(binLinkDir, 'llxprt')) + ';',
            'try { fs.mkdirSync(' +
              JSON.stringify(binLinkDir) +
              ', { recursive: true }); } catch {}',
            'try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(' +
              JSON.stringify(launcherSource) +
              ', target); fs.chmodSync(target, 0o755); } catch {}',
            'cmdShim(target, link, function(err) {',
            '  if (err) { console.error(err.message); process.exit(1); }',
            '  process.exit(0);',
            '});',
          ].join(''),
        ],
        { encoding: 'utf8', timeout: 15_000 },
      );
      if (result.status !== 0) {
        throw new Error(`cmd-shim generation failed: ${result.stderr}`);
      }
      return join(binLinkDir, 'llxprt.cmd');
    }

    it('recognizes a real npm cmd-shim (dp0 pattern) pointing to our package', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-cmd-shim-'));
      try {
        const packageRoot = join(
          tempDir,
          'prefix',
          'lib',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        const binTarget = join(packageRoot, 'bin', 'llxprt');
        const binLinkDir = join(tempDir, 'bin-link');
        const shimPath = generateRealCmdShim(binLinkDir, binTarget);
        expect(
          mod.pointsToOurPackage(shimPath, binLinkDir, packageRoot, 'cmd'),
        ).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects an npm cmd-shim pointing to a sibling package (llxprt-code-evil)', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-evil-'));
      try {
        const evilRoot = join(
          tempDir,
          'prefix',
          'lib',
          'node_modules',
          '@vybestack',
          'llxprt-code-evil',
        );
        const binTarget = join(evilRoot, 'bin', 'llxprt');
        const binLinkDir = join(tempDir, 'bin-link');
        const ourPackageRoot = join(
          tempDir,
          'prefix',
          'lib',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        mkdirSync(ourPackageRoot, { recursive: true });
        const shimPath = generateRealCmdShim(binLinkDir, binTarget);
        expect(
          mod.pointsToOurPackage(shimPath, binLinkDir, ourPackageRoot, 'cmd'),
        ).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('recognizes a real npm ps1 shim ($basedir pattern) pointing to our package', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-ps1-shim-'));
      try {
        const packageRoot = join(
          tempDir,
          'prefix',
          'lib',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        const binTarget = join(packageRoot, 'bin', 'llxprt');
        const binLinkDir = join(tempDir, 'bin-link');
        generateRealCmdShim(binLinkDir, binTarget);
        const ps1Path = join(binLinkDir, 'llxprt.ps1');
        expect(
          mod.pointsToOurPackage(ps1Path, binLinkDir, packageRoot, 'ps1'),
        ).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects a ps1 shim pointing to a different package', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-ps1-evil-'));
      try {
        const evilRoot = join(
          tempDir,
          'prefix',
          'lib',
          'node_modules',
          '@vybestack',
          'llxprt-code-evil',
        );
        const binTarget = join(evilRoot, 'bin', 'llxprt');
        const binLinkDir = join(tempDir, 'bin-link');
        const ourPackageRoot = join(
          tempDir,
          'prefix',
          'lib',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        mkdirSync(ourPackageRoot, { recursive: true });
        generateRealCmdShim(binLinkDir, binTarget);
        const ps1Path = join(binLinkDir, 'llxprt.ps1');
        expect(
          mod.pointsToOurPackage(ps1Path, binLinkDir, ourPackageRoot, 'ps1'),
        ).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('authorizes overwriting a file with our sentinel', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-sentinel-'));
      try {
        const filePath = join(tempDir, 'llxprt.cmd');
        writeFileSync(
          filePath,
          `REM ${mod.OWNERSHIP_SENTINEL}\n@echo off\necho old`,
        );
        expect(mod.hasOwnershipSentinel(filePath)).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('does not authorize overwriting a foreign file', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-foreign-'));
      try {
        const filePath = join(tempDir, 'llxprt.cmd');
        writeFileSync(filePath, '@echo off\necho someone else');
        expect(mod.hasOwnershipSentinel(filePath)).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('installNativeLaunchers platform gating', () => {
    it('is a no-op on POSIX', () => {
      const mod = loadCliInstaller();
      const result = mod.installNativeLaunchers({
        platform: 'darwin',
        packageRoot: repoRoot,
        log: () => {},
      });
      expect(result.written).toEqual([]);
      expect(result.skipped).toEqual([]);
    });

    it('generates launchers for global install (npm_config_global=true)', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-global-'));
      try {
        const packageRoot = join(
          tempDir,
          'lib',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        const prefix = join(tempDir);
        mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          'fake',
        );
        writeFileSync(join(packageRoot, 'index.ts'), '// entry');

        const result = mod.installNativeLaunchers({
          platform: 'win32',
          packageRoot,
          env: {
            npm_config_global: 'true',
            npm_config_prefix: prefix,
          },
          log: () => {},
        });
        expect(result.written.length).toBe(2);
        expect(existsSync(join(prefix, 'llxprt.cmd'))).toBe(true);
        expect(existsSync(join(prefix, 'llxprt.ps1'))).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('generates launchers for local install (INIT_CWD set)', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-local-'));
      try {
        const packageRoot = join(
          tempDir,
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        const initCwd = join(tempDir, 'consumer');
        mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          'fake',
        );
        writeFileSync(join(packageRoot, 'index.ts'), '// entry');
        const dotBin = join(initCwd, 'node_modules', '.bin');
        mkdirSync(dotBin, { recursive: true });

        const result = mod.installNativeLaunchers({
          platform: 'win32',
          packageRoot,
          env: {
            npm_config_global: '',
            INIT_CWD: initCwd,
          },
          log: () => {},
        });
        expect(result.written.length).toBe(2);
        expect(existsSync(join(dotBin, 'llxprt.cmd'))).toBe(true);
        expect(existsSync(join(dotBin, 'llxprt.ps1'))).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('does not treat npm_config_prefix as bin dir for local install', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-noprefix-'));
      try {
        const packageRoot = join(
          tempDir,
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        const initCwd = join(tempDir, 'consumer');
        mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          'fake',
        );
        writeFileSync(join(packageRoot, 'index.ts'), '// entry');
        mkdirSync(join(initCwd, 'node_modules', '.bin'), { recursive: true });

        mod.installNativeLaunchers({
          platform: 'win32',
          packageRoot,
          env: {
            npm_config_global: '',
            npm_config_prefix: initCwd,
            INIT_CWD: initCwd,
          },
          log: () => {},
        });
        expect(existsSync(join(initCwd, 'llxprt.cmd'))).toBe(false);
        expect(
          existsSync(join(initCwd, 'node_modules', '.bin', 'llxprt.cmd')),
        ).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('derives scoped package bin from nearest node_modules ancestor', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-scoped-'));
      try {
        const packageRoot = join(
          tempDir,
          'consumer',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          'fake',
        );
        writeFileSync(join(packageRoot, 'index.ts'), '// entry');
        const dotBin = join(tempDir, 'consumer', 'node_modules', '.bin');
        mkdirSync(dotBin, { recursive: true });

        const result = mod.installNativeLaunchers({
          platform: 'win32',
          packageRoot,
          env: {},
          log: () => {},
        });
        expect(result.written.length).toBe(2);
        expect(existsSync(join(dotBin, 'llxprt.cmd'))).toBe(true);
        expect(existsSync(join(dotBin, 'llxprt.ps1'))).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('handles npm_config_global undefined (not just empty)', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-undef-global-'));
      try {
        const packageRoot = join(
          tempDir,
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          'fake',
        );
        writeFileSync(join(packageRoot, 'index.ts'), '// entry');
        const dotBin = join(tempDir, 'node_modules', '.bin');
        mkdirSync(dotBin, { recursive: true });

        const result = mod.installNativeLaunchers({
          platform: 'win32',
          packageRoot,
          env: { npm_config_global: undefined },
          log: () => {},
        });
        expect(result.written.length).toBe(2);
        expect(existsSync(join(dotBin, 'llxprt.cmd'))).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('derives bin from packageRoot even when INIT_CWD is unrelated (npx cache shape)', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-npx-'));
      try {
        const packageRoot = join(
          tempDir,
          'npx-cache',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          'fake',
        );
        writeFileSync(join(packageRoot, 'index.ts'), '// entry');
        const packageDotBin = join(
          tempDir,
          'npx-cache',
          'node_modules',
          '.bin',
        );
        mkdirSync(packageDotBin, { recursive: true });

        const unrelatedInitCwd = join(tempDir, 'somewhere-else');
        mod.installNativeLaunchers({
          platform: 'win32',
          packageRoot,
          env: { INIT_CWD: unrelatedInitCwd },
          log: () => {},
        });
        expect(existsSync(join(packageDotBin, 'llxprt.cmd'))).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('does not write consumer-root wrappers for local install', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-no-consumer-'));
      try {
        const packageRoot = join(
          tempDir,
          'consumer',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        const initCwd = join(tempDir, 'consumer');
        mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
          recursive: true,
        });
        writeFileSync(
          join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          'fake',
        );
        writeFileSync(join(packageRoot, 'index.ts'), '// entry');
        mkdirSync(join(initCwd, 'node_modules', '.bin'), { recursive: true });

        mod.installNativeLaunchers({
          platform: 'win32',
          packageRoot,
          env: { INIT_CWD: initCwd },
          log: () => {},
        });
        expect(existsSync(join(initCwd, 'llxprt.cmd'))).toBe(false);
        expect(existsSync(join(initCwd, 'llxprt.ps1'))).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('nearestNodeModulesBin derivation', () => {
    it('finds node_modules/.bin for scoped package', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-nm-scoped-'));
      try {
        const packageRoot = join(
          tempDir,
          'project',
          'node_modules',
          '@vybestack',
          'llxprt-code',
        );
        mkdirSync(packageRoot, { recursive: true });
        const dotBin = join(tempDir, 'project', 'node_modules', '.bin');
        mkdirSync(dotBin, { recursive: true });
        expect(mod.nearestNodeModulesBin(packageRoot)).toBe(dotBin);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('finds node_modules/.bin for unscoped package', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-nm-unscoped-'));
      try {
        const packageRoot = join(
          tempDir,
          'project',
          'node_modules',
          'llxprt-code',
        );
        mkdirSync(packageRoot, { recursive: true });
        const dotBin = join(tempDir, 'project', 'node_modules', '.bin');
        mkdirSync(dotBin, { recursive: true });
        expect(mod.nearestNodeModulesBin(packageRoot)).toBe(dotBin);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('returns null when no enclosing node_modules exists', () => {
      const mod = loadCliInstaller();
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-nm-none-'));
      try {
        expect(mod.nearestNodeModulesBin(tempDir)).toBeNull();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('cmd launcher exit-code preservation', () => {
    it('preserves the child exit code exactly (no remapping)', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      // cmd cannot reliably distinguish a launch failure from a legitimate
      // nonzero exit, so it must NOT remap any errorlevel. It preserves
      // %ERRORLEVEL% directly.
      expect(cmd).toContain('exit /b %ERRORLEVEL%');
      expect(cmd).not.toMatch(/LLXPRT_EXITCODE/);
      expect(cmd).not.toMatch(/LLXPRT_LAUNCH_FAIL/);
    });

    it('does not remap errorlevel 5, 193, or 9009', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      // These errorlevels may be legitimate CLI exit codes; remapping them
      // would corrupt the child's real exit status.
      expect(cmd).not.toMatch(/equ 9009/);
      expect(cmd).not.toMatch(/equ 193/);
      expect(cmd).not.toMatch(/equ 5\b/);
    });

    it('still exits 43 for missing bun (existence preflight)', () => {
      const mod = loadCliInstaller();
      const cmd = mod.generateCmdLauncher('bun.exe', 'index.ts');
      expect(cmd).toContain('goto :LLXPRT_NO_BUN');
      expect(cmd).toContain('exit /b ' + mod.LAUNCHER_ERROR_EXIT_CODE);
    });
  });

  describe('ps1 launcher launch-failure diagnostics', () => {
    it('wraps invocation in try/catch for native launch exceptions', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('bun.exe', 'index.ts');
      expect(ps1).toContain('try {');
      expect(ps1).toContain('} catch {');
      expect(ps1).toContain('exit ' + mod.LAUNCHER_ERROR_EXIT_CODE);
    });

    it('still propagates LASTEXITCODE for normal nonzero exits', () => {
      const mod = loadCliInstaller();
      const ps1 = mod.generatePs1Launcher('bun.exe', 'index.ts');
      expect(ps1).toContain('exit $LASTEXITCODE');
    });
  });
});
