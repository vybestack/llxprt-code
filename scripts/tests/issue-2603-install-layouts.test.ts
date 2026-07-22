/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
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

/**
 * Reads the CLI package manifest to derive the pnpm virtual-store directory
 * name, which encodes `<scope>+<name>@<version>`. Both name and version are
 * derived dynamically so this test tracks the actual published manifest.
 */
interface CliManifest {
  name: string;
  version: string;
}

function readCliManifest(): CliManifest {
  const cliPkg = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
  ) as { name?: string; version?: string };
  if (
    typeof cliPkg.name !== 'string' ||
    cliPkg.name.length === 0 ||
    typeof cliPkg.version !== 'string' ||
    cliPkg.version.length === 0
  ) {
    throw new Error('packages/cli/package.json is missing name or version');
  }
  return { name: cliPkg.name, version: cliPkg.version };
}

const CLI_MANIFEST = readCliManifest();
// pnpm encodes the scope separator as + in the virtual-store directory name.
const PNPM_PACKAGE_DIR = `${CLI_MANIFEST.name.replace(/^@/, '').replace(/\//g, '+')}@${CLI_MANIFEST.version}`;
// Derive the package scope and unscoped name from the manifest so these paths
// stay correct if the package name or scope ever changes.
const [CLI_SCOPE, ...CLI_NAME_PARTS] = CLI_MANIFEST.name.split('/');
const CLI_NAME = CLI_NAME_PARTS.join('/') || CLI_MANIFEST.name;
// The bin name is derived from the CLI manifest's bin field so assertions
// adapt automatically if the bin name ever changes from 'llxprt'.
const CLI_BIN_NAME = (() => {
  try {
    const binPkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
    ) as { bin?: Record<string, string> };
    const binEntries = Object.values(binPkg.bin ?? {});
    return binEntries.length > 0
      ? binEntries[0].replace(/^bin\//, '')
      : 'llxprt';
  } catch {
    return 'llxprt';
  }
})();

function loadCliInstaller(): ReturnType<typeof nodeRequire> {
  const mod = nodeRequire(cliModulePath);
  // Implementation-detail helpers are exposed under a private `_testing`
  // namespace; merge them onto the top-level return for legacy `mod.X` access.
  return { ...mod, ...mod._testing };
}

describe('pnpm virtual-store layout (consumer-visible .bin)', () => {
  function setupPnpmVirtualStore(tempDir: string): {
    packageRoot: string;
    consumerRoot: string;
    consumerDotBin: string;
    virtualStoreNodeModules: string;
  } {
    const consumerRoot = join(tempDir, 'consumer');
    const packageRoot = join(
      consumerRoot,
      'node_modules',
      '.pnpm',
      PNPM_PACKAGE_DIR,
      'node_modules',
      CLI_SCOPE,
      CLI_NAME,
    );
    const consumerDotBin = join(consumerRoot, 'node_modules', '.bin');
    const virtualStoreNodeModules = join(
      consumerRoot,
      'node_modules',
      '.pnpm',
      PNPM_PACKAGE_DIR,
      'node_modules',
    );
    mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
      recursive: true,
    });
    writeFileSync(
      join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
      'fake',
    );
    writeFileSync(join(packageRoot, 'index.ts'), '// entry');
    mkdirSync(consumerDotBin, { recursive: true });
    return {
      packageRoot,
      consumerRoot,
      consumerDotBin,
      virtualStoreNodeModules,
    };
  }

  it('writes launchers to consumer-visible node_modules/.bin, not virtual-store .bin', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pnpm-vs-'));
    try {
      const { packageRoot, consumerRoot, consumerDotBin } =
        setupPnpmVirtualStore(tempDir);
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: consumerRoot },
        log: () => {},
      });
      expect(result.written.length).toBeGreaterThanOrEqual(2);
      expect(existsSync(join(consumerDotBin, `${CLI_BIN_NAME}.cmd`))).toBe(
        true,
      );
      expect(existsSync(join(consumerDotBin, `${CLI_BIN_NAME}.ps1`))).toBe(
        true,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not write launchers into the virtual-store node_modules/.bin', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pnpm-novs-'));
    try {
      const { packageRoot, consumerRoot, virtualStoreNodeModules } =
        setupPnpmVirtualStore(tempDir);
      mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: consumerRoot },
        log: () => {},
      });
      const virtualDotBin = join(virtualStoreNodeModules, '.bin');
      expect(existsSync(join(virtualDotBin, `${CLI_BIN_NAME}.cmd`))).toBe(
        false,
      );
      expect(existsSync(join(virtualDotBin, `${CLI_BIN_NAME}.ps1`))).toBe(
        false,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses INIT_CWD to find consumer .bin when nearestNodeModulesBin resolves into virtual store', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pnpm-initcwd-'));
    try {
      const { packageRoot, consumerRoot, consumerDotBin } =
        setupPnpmVirtualStore(tempDir);
      const nearest = mod.nearestNodeModulesBin(packageRoot);
      expect(nearest).toBe(
        join(
          tempDir,
          'consumer',
          'node_modules',
          '.pnpm',
          PNPM_PACKAGE_DIR,
          'node_modules',
          '.bin',
        ),
      );
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: consumerRoot },
        log: () => {},
      });
      const writtenToConsumer = result.written.filter((p: string) =>
        p.startsWith(consumerDotBin),
      );
      expect(writtenToConsumer.length).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ownership validation rejects a foreign-package cmd shim in consumer .bin', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pnpm-foreign-'));
    try {
      const { packageRoot, consumerRoot, consumerDotBin } =
        setupPnpmVirtualStore(tempDir);
      const foreignCmd = join(consumerDotBin, `${CLI_BIN_NAME}.cmd`);
      writeFileSync(foreignCmd, '@echo off\necho someone else');
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: consumerRoot },
        log: () => {},
      });
      expect(result.skipped).toContain(foreignCmd);
      expect(readFileSync(foreignCmd, 'utf8')).toContain('someone else');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ownership validation accepts our own sentinel in consumer .bin', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pnpm-sentinel-'));
    try {
      const { packageRoot, consumerRoot, consumerDotBin } =
        setupPnpmVirtualStore(tempDir);
      const ourCmd = join(consumerDotBin, `${CLI_BIN_NAME}.cmd`);
      writeFileSync(ourCmd, `REM ${mod.OWNERSHIP_SENTINEL}\n@echo off`);
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: consumerRoot },
        log: () => {},
      });
      expect(result.written).toContain(ourCmd);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ownership validation rejects a foreign-package ps1 shim in consumer .bin', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pnpm-ps1-foreign-'));
    try {
      const { packageRoot, consumerRoot, consumerDotBin } =
        setupPnpmVirtualStore(tempDir);
      const foreignPs1 = join(consumerDotBin, `${CLI_BIN_NAME}.ps1`);
      writeFileSync(
        foreignPs1,
        '#!/usr/bin/env pwsh\nWrite-Host "someone else"\n',
      );
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: consumerRoot },
        log: () => {},
      });
      expect(result.skipped).toContain(foreignPs1);
      expect(readFileSync(foreignPs1, 'utf8')).toContain('someone else');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ownership validation accepts our own sentinel ps1 in consumer .bin', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-pnpm-ps1-sentinel-'));
    try {
      const { packageRoot, consumerRoot, consumerDotBin } =
        setupPnpmVirtualStore(tempDir);
      const ourPs1 = join(consumerDotBin, `${CLI_BIN_NAME}.ps1`);
      writeFileSync(
        ourPs1,
        `# ${mod.OWNERSHIP_SENTINEL}\n#!/usr/bin/env pwsh\n`,
      );
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: consumerRoot },
        log: () => {},
      });
      expect(result.written).toContain(ourPs1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('installNativeLaunchers graceful error contract', () => {
  function setupPackageRoot(tempDir: string): string {
    const packageRoot = join(tempDir, 'pkg');
    mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
      recursive: true,
    });
    writeFileSync(
      join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
      'fake',
    );
    writeFileSync(join(packageRoot, 'index.ts'), '// entry');
    mkdirSync(join(tempDir, 'node_modules', '.bin'), { recursive: true });
    return packageRoot;
  }

  it('returns the exact result contract on POSIX no-op', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-contract-posix-'));
    try {
      const packageRoot = setupPackageRoot(tempDir);
      const result = mod.installNativeLaunchers({
        platform: 'darwin',
        packageRoot,
        log: () => {},
      });
      expect(result).toStrictEqual({ written: [], skipped: [], error: null });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns the exact result contract on a successful win32 install', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-contract-ok-'));
    try {
      const packageRoot = setupPackageRoot(tempDir);
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: tempDir },
        log: () => {},
      });
      expect(Object.keys(result).sort()).toStrictEqual(
        ['error', 'skipped', 'written'].sort(),
      );
      expect(result.error).toBeNull();
      expect(result.written.length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns bun-not-found error with empty written/skipped when Bun is absent', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-contract-nobun-'));
    try {
      const packageRoot = join(tempDir, 'pkg');
      // No node_modules/bun/bin/bun.exe created.
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(join(packageRoot, 'index.ts'), '// entry');
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: tempDir },
        log: () => {},
      });
      expect(result).toStrictEqual({
        written: [],
        skipped: [],
        error: 'bun-not-found',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns entry-not-found error with empty written/skipped when entry is absent', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-contract-noentry-'));
    try {
      const packageRoot = join(tempDir, 'pkg');
      mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'fake',
      );
      // No index.ts created.
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: tempDir },
        log: () => {},
      });
      expect(result).toStrictEqual({
        written: [],
        skipped: [],
        error: 'entry-not-found',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Bun install layout support boundary', () => {
  it('CLI package.json declares a postinstall that Bun will run', () => {
    const cliPkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(cliPkg.scripts.postinstall).toMatch(/install-native-launchers/);
  });

  it('root trustedDependencies includes bun so Bun runs its lifecycle', () => {
    const rootPkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as { trustedDependencies?: string[] };
    expect(rootPkg.trustedDependencies).toContain('bun');
  });

  it('Bun hoisted-layout bin resolution: bun.exe is resolvable from package root', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-bun-layout-'));
    try {
      const packageRoot = join(tempDir, 'node_modules', CLI_SCOPE, CLI_NAME);
      mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'fake',
      );
      writeFileSync(join(packageRoot, 'index.ts'), '// entry');
      mkdirSync(join(tempDir, 'node_modules', '.bin'), { recursive: true });
      const bunExe = mod.resolveBunExe(packageRoot);
      expect(bunExe).toBeTruthy();
      expect(bunExe).toContain('bun.exe');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('installer writes to consumer .bin for Bun hoisted layout via INIT_CWD', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-bun-initcwd-'));
    try {
      const packageRoot = join(tempDir, 'node_modules', CLI_SCOPE, CLI_NAME);
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
      mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: { INIT_CWD: tempDir },
        log: () => {},
      });
      expect(existsSync(join(dotBin, `${CLI_BIN_NAME}.cmd`))).toBe(true);
      expect(existsSync(join(dotBin, `${CLI_BIN_NAME}.ps1`))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolveBunExe prefers package-local Bun over a hoisted ancestor', () => {
    // Since bun is a direct dependency, the package-local
    // node_modules/bun/bin/bun.exe must be preferred over a hoisted copy in a
    // parent node_modules. This prevents the launcher from referencing an
    // external hoisted path that could disappear.
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-bun-local-pref-'));
    try {
      const packageRoot = join(tempDir, 'node_modules', CLI_SCOPE, CLI_NAME);
      // Package-local Bun.
      mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'local-bun',
      );
      // Hoisted ancestor Bun that would shadow if walk-up ran first.
      mkdirSync(join(tempDir, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(tempDir, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'hoisted-bun',
      );
      const resolved = mod.resolveBunExe(packageRoot);
      expect(resolved).toBeTruthy();
      expect(readFileSync(resolved, 'utf8')).toBe('local-bun');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
