/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  readFileSync,
  readdirSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { resolve, join, sep, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');

function relativeToRepo(p: string): string {
  const prefix = repoRoot + sep;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

function readRootPackageJson(): PackageJson {
  return JSON.parse(
    readFileSync(resolve(repoRoot, 'package.json'), 'utf-8'),
  ) as PackageJson;
}

const rootPkg = readRootPackageJson();
const NL = '\n';
function expectScriptDefined(
  scripts: Record<string, string>,
  key: string,
): string {
  const command = scripts[key];
  expect(command, `package.json scripts.${key} must be defined`).toBeDefined();
  if (command === undefined) {
    throw new Error(`package.json scripts.${key} must be defined`);
  }
  return command;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isEnoent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as Record<string, unknown>).code === 'ENOENT';
}

function unquoteToken(token: string): string {
  if (token.length < 2) {
    return token;
  }
  const first = token[0];
  const last = token[token.length - 1];
  return (first === '"' || first === "'") && first === last
    ? token.slice(1, -1)
    : token;
}

function commandInvokesBunScript(
  command: string,
  scriptFragment: string,
): boolean {
  const tokens = command.split(/\s+/);
  return tokens.some((token, index) => {
    const runner = unquoteToken(token);
    if (runner !== 'bun' && runner !== 'bunx') return false;
    const previous = index > 0 ? unquoteToken(tokens[index - 1]) : '';
    const isCommandPosition =
      index === 0 ||
      ['&&', '||', ';', '|', '&'].includes(previous) ||
      previous === 'cross-env' ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(previous);
    if (!isCommandPosition) return false;
    for (const candidateToken of tokens.slice(index + 1)) {
      const candidate = unquoteToken(candidateToken);
      if (candidate.startsWith('-')) continue;
      return candidate.includes(scriptFragment);
    }
    return false;
  });
}

describe('Issue #2242: package.json scripts use Bun for converted .ts scripts', () => {
  const pkg = rootPkg;
  const scripts = pkg.scripts ?? {};
  const BUN_INVOCATIONS: ReadonlyArray<readonly [string, string]> = [
    ['start', 'scripts/dev-env.ts'],
    ['debug', 'scripts/start.ts'],
    ['deflake', 'scripts/deflake.ts'],
    ['generate', 'scripts/generate-git-commit-info.ts'],
    ['generate', 'scripts/generate_prompt_manifest.ts'],
    ['build', 'scripts/build.ts'],
    ['build:vscode', 'scripts/build_vscode_companion.ts'],
    ['build:sandbox', 'scripts/build_sandbox.ts'],
    ['lint:runner', 'scripts/run-lint.ts'],
    ['lint:eslint-guard', 'scripts/check-eslint-guard.ts'],
    ['lint:cli-boundary', 'scripts/check-cli-import-boundary.ts'],
    ['prepare:package', 'scripts/prepare-package.ts'],
    ['release:version', 'scripts/version.ts'],
    ['telemetry', 'scripts/telemetry.ts'],
    ['check:lockfile', 'scripts/check-lockfile.ts'],
    ['clean', 'scripts/clean.ts'],
  ];
  it.each(BUN_INVOCATIONS)(
    'scripts.%s invokes bun with the converted .ts script (%s)',
    (key, scriptFragment) => {
      const command = expectScriptDefined(scripts, key);
      expect(commandInvokesBunScript(command, scriptFragment)).toBe(true);
    },
  );

  it('schema:settings invokes bun with the converted .ts script', () => {
    expect(
      commandInvokesBunScript(
        expectScriptDefined(scripts, 'schema:settings'),
        'scripts/generate-settings-schema.ts',
      ),
    ).toBe(true);
  });

  it('docs:settings invokes bun with the converted .ts script', () => {
    expect(
      commandInvokesBunScript(
        expectScriptDefined(scripts, 'docs:settings'),
        'scripts/generate-settings-doc.ts',
      ),
    ).toBe(true);
  });

  it('docs:keybindings invokes bun with the converted .ts script', () => {
    expect(
      commandInvokesBunScript(
        expectScriptDefined(scripts, 'docs:keybindings'),
        'scripts/generate-keybindings-doc.ts',
      ),
    ).toBe(true);
  });

  it('debug uses Bun inspector-compatible flag', () => {
    const command = expectScriptDefined(scripts, 'debug');
    expect(command).toContain('--inspect');
  });
});

describe('Issue #2242: Node-only lifecycle hooks preserved', () => {
  const scripts = rootPkg.scripts ?? {};

  it('preinstall stays on node scripts/*.cjs (pre-Bun bootstrap)', () => {
    const command = expectScriptDefined(scripts, 'preinstall');
    expect(command).toContain('node');
    expect(command).toContain('scripts/preinstall.cjs');
  });
  it('postinstall stays on node scripts/*.cjs (pre-Bun bootstrap)', () => {
    const command = expectScriptDefined(scripts, 'postinstall');
    expect(command).toContain('node');
    expect(command).toContain('scripts/postinstall.cjs');
  });
});

describe('Issue #2242: no stale .js/.mjs references to converted scripts', () => {
  const allCommands = Object.values(rootPkg.scripts ?? {}).join('\n');

  const CONVERTED_SCRIPTS = [
    'scripts/start',
    'scripts/build',
    'scripts/clean',
    'scripts/version',
    'scripts/deflake',
    'scripts/telemetry',
    'scripts/check-lockfile',
    'scripts/check-eslint-guard',
    'scripts/generate-git-commit-info',
    'scripts/generate_prompt_manifest',
    'scripts/bind-release-deps',
    'scripts/build_package',
    'scripts/build_sandbox',
    'scripts/build_vscode_companion',
    'scripts/copy_bundle_assets',
    'scripts/copy_files',
    'scripts/prepare-package',
    'scripts/chmod_executable',
    'scripts/check-build-status',
    'scripts/check-cli-import-boundary',
    'scripts/sandbox_command',
    'scripts/get-release-version',
    'scripts/run-lint',
    'scripts/check-storage-import-boundary',
    'scripts/check-storage-package-cycle',
    'scripts/generate-settings-schema',
    'scripts/generate-settings-doc',
    'scripts/generate-keybindings-doc',
  ] as const;

  it.each(CONVERTED_SCRIPTS)(
    'no package.json script references the old .js extension for %s',
    (scriptBase) => {
      // The old .js path must not appear in any workflow command.
      expect(allCommands).not.toContain(`${scriptBase}.js`);
    },
  );

  it.each(CONVERTED_SCRIPTS)(
    'no package.json script references the old .mjs extension for %s',
    (scriptBase) => {
      expect(allCommands).not.toContain(`${scriptBase}.mjs`);
    },
  );

  it.each(CONVERTED_SCRIPTS)(
    'no package.json script invokes %s via node (must use bun)',
    (scriptBase) => {
      for (const command of Object.values(rootPkg.scripts ?? {})) {
        expect(command).not.toMatch(
          new RegExp(`node[\\s\\S]*${escapeRegExp(scriptBase)}\\.(js|mjs)`),
        );
      }
    },
  );
});

describe('Issue #2242: workspace package.json build scripts use Bun', () => {
  const packagesDir = resolve(repoRoot, 'packages');

  function readPackageJson(pkgDir: string): PackageJson | undefined {
    const pkgPath = resolve(packagesDir, pkgDir, 'package.json');
    try {
      return JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  function readWorkspaceScripts(pkgDir: string): Record<string, string> {
    const pkg = readPackageJson(pkgDir);
    if (pkg === undefined) {
      throw new Error(
        `Missing ${resolve(packagesDir, pkgDir, 'package.json')}`,
      );
    }
    if (!pkg.scripts) {
      throw new Error(
        `No scripts in ${resolve(packagesDir, pkgDir, 'package.json')}`,
      );
    }
    return pkg.scripts;
  }

  function readBuildScript(pkgDir: string): string | undefined {
    return readPackageJson(pkgDir)?.scripts?.['build'];
  }

  const BUILDPACKAGE_PACKAGES = readdirSync(packagesDir, {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        readBuildScript(entry.name)?.includes('build_package.ts') === true,
    )
    .map((entry) => entry.name);

  it('at least one workspace package uses build_package.ts', () => {
    expect(BUILDPACKAGE_PACKAGES.length).toBeGreaterThan(0);
  });
  it.each(BUILDPACKAGE_PACKAGES)(
    'packages/%s build invokes bun ../../scripts/build_package.ts',
    (pkgDir) => {
      const scripts = readWorkspaceScripts(pkgDir);
      const build = scripts['build'];
      expect(
        build,
        `packages/${pkgDir}/package.json must define a build script`,
      ).toBeDefined();
      expect(build).toContain('bun');
      expect(build).toContain('scripts/build_package.ts');
    },
  );

  it('packages/cli build invokes build_package.ts then chmod_executable.ts', () => {
    const scripts = readWorkspaceScripts('cli');
    const build = scripts['build'];
    expect(build).toBeDefined();
    expect(build).toContain('bun');
    expect(build).toContain('scripts/build_package.ts');
    // The CLI entrypoint must be made executable after bundling.
    expect(build).toContain('scripts/chmod_executable.ts');
    expect(build).toContain('dist/index.js');
  });
  it('BUILDPACKAGE_PACKAGES covers every workspace package using build_package.ts', () => {
    const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    let checkedCount = 0;
    for (const packageDir of packageDirs) {
      const build = readBuildScript(packageDir);
      if (build?.includes('build_package.ts')) {
        expect(BUILDPACKAGE_PACKAGES).toContain(packageDir);
        checkedCount += 1;
      }
    }
    expect(checkedCount, 'build_package.ts users').toBeGreaterThan(0);
  });

  it('packages/cli build runs build_package before chmod_executable', () => {
    const scripts = readWorkspaceScripts('cli');
    const build = expectScriptDefined(scripts, 'build');
    const buildPackageIdx = build.indexOf('build_package.ts');
    const chmodIdx = build.indexOf('chmod_executable.ts');
    expect(buildPackageIdx).toBeGreaterThanOrEqual(0);
    expect(chmodIdx).toBeGreaterThan(buildPackageIdx);
  });

  it('packages/cli does not retain removed prerelease helper references', () => {
    const allScripts = Object.values(readWorkspaceScripts('cli')).join('\n');
    expect(allScripts).not.toContain('bind_package_version.js');
    expect(allScripts).not.toContain('bind_package_dependencies.js');
  });
  it('packages/cli has no prepack (no-compile publish contract ships TS source)', () => {
    const scripts = readWorkspaceScripts('cli');
    expect(scripts['prepack']).toBeUndefined();
  });

  it('workspace build scripts reference build_package.ts via the bun-shared ../../ path', () => {
    const pkgDirs = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('.'));

    let checkedCount = 0;
    for (const pkgDir of pkgDirs) {
      const build = readBuildScript(pkgDir);
      if (build && build.includes('build_package.ts')) {
        expect(build).toContain('bun ../../scripts/build_package.ts');
        checkedCount += 1;
      }
    }
    expect(checkedCount, 'build_package.ts users').toBeGreaterThan(0);
  });
});

// Issue #2242 stale-reference guard for deleted migrated scripts.
describe('Issue #2242: active surfaces do not reference deleted migrated scripts', () => {
  const DELETED_MIGRATED_PATHS = [
    'scripts/start.js',
    'scripts/bind-release-deps.js',
    'scripts/bind_package_dependencies.js',
    'scripts/bind_package_version.js',
    'scripts/build.js',
    'scripts/build_package.js',
    'scripts/build_sandbox.js',
    'scripts/build_vscode_companion.js',
    'scripts/check-build-status.js',
    'scripts/check-cli-import-boundary.mjs',
    'scripts/check-eslint-guard.js',
    'scripts/check-lockfile.js',
    'scripts/check-storage-import-boundary.mjs',
    'scripts/check-storage-package-cycle.mjs',
    'scripts/chmod_executable.js',
    'scripts/clean.js',
    'scripts/copy_bundle_assets.js',
    'scripts/copy_files.js',
    'scripts/deflake.js',
    'scripts/generate-git-commit-info.js',
    'scripts/generate_prompt_manifest.js',
    'scripts/get-release-version.js',
    'scripts/generate-settings-schema.js',
    'scripts/generate-settings-doc.js',
    'scripts/generate-keybindings-doc.js',
    'scripts/prepare-package.js',
    'scripts/run-lint.mjs',
    'scripts/sandbox_command.js',
    'scripts/telemetry.js',
    'scripts/version.js',
  ] as const;

  const ACTIVE_SCAN_ROOTS = [
    '.github/workflows',
    'packages',
    'docs',
    'dev-docs',
    'shell-scripts',
    'scripts',
  ] as const;

  const ROOT_LEVEL_FILES = [
    'AGENTS.md',
    'CONTRIBUTING.md',
    'README.md',
    'ROADMAP.md',
  ] as const;

  const EXCLUDE_DIR_NAMES = new Set([
    'node_modules',
    'dist',
    '.git',
    'project-plans',
  ]);

  const FIXTURE_EXCLUSIONS = new Set<string>([relativeToRepo(thisFile)]);

  /**
   * File extensions whose contents are scanned as text.
   */
  const SCANNABLE_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.sh',
    '.md',
    '.json',
    '.yml',
    '.yaml',
  ]);

  function fileExtension(name: string): string {
    const dotIndex = name.lastIndexOf('.');
    return dotIndex === -1 ? '' : name.slice(dotIndex);
  }

  function isScannableFile(name: string): boolean {
    return SCANNABLE_EXTENSIONS.has(fileExtension(name));
  }

  function existsDir(p: string): boolean {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  function collectScannableFiles(dir: string, acc: string[] = []): string[] {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const entry of entries) {
      const childPath = join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !EXCLUDE_DIR_NAMES.has(entry.name)
      ) {
        collectScannableFiles(childPath, acc);
      } else if (
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        isScannableFile(entry.name)
      ) {
        acc.push(childPath);
      }
    }
    return acc;
  }

  function stripNegativeAssertions(content: string): string {
    const patterns = ['.not.toContain(', '.not.toMatch(', '.not.toInclude('];
    let result = content;
    for (const pattern of patterns) {
      let start = result.indexOf(pattern);
      while (start !== -1) {
        const end = negativeAssertionEnd(result, start + pattern.length);
        if (end === -1) {
          start = result.indexOf(pattern, start + pattern.length);
          continue;
        }
        result = result.slice(0, start) + result.slice(end);
        start = result.indexOf(pattern, start);
      }
    }
    return result;
  }

  function quoteIsUnescaped(content: string, quoteIndex: number): boolean {
    let backslashes = 0;
    for (
      let index = quoteIndex - 1;
      index >= 0 && content[index] === '\\';
      index -= 1
    ) {
      backslashes += 1;
    }
    return backslashes % 2 === 0;
  }

  function negativeAssertionEnd(content: string, start: number): number {
    let depth = 1;
    let quote: string | null = null;
    for (let index = start; index < content.length; index += 1) {
      const char = content[index];
      if (quote !== null) {
        if (char === quote && quoteIsUnescaped(content, index)) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      }
      if (depth === 0) {
        const nextIndex = index + 1;
        return nextIndex < content.length && content[nextIndex] === ';'
          ? nextIndex + 1
          : nextIndex;
      }
    }
    return -1;
  }

  function isTestSpecFile(file: string): boolean {
    const rel = relativeToRepo(file);
    return (
      rel.includes('__tests__/') ||
      /\.test\.[A-Za-z0-9]+$/.test(rel) ||
      /\.spec\.[A-Za-z0-9]+$/.test(rel)
    );
  }

  function readFileOrNull(file: string): string | null {
    try {
      return readFileSync(file, 'utf-8');
    } catch (error) {
      if (!isEnoent(error)) throw error;
      return null;
    }
  }

  function findStaleReferencesIn(file: string): string[] {
    const rel = relativeToRepo(file);
    if (FIXTURE_EXCLUSIONS.has(rel)) return [];
    const skipNegativeAssertions = isTestSpecFile(file);
    const content = readFileOrNull(file);
    if (content === null) {
      return [];
    }
    const scannedContent = skipNegativeAssertions
      ? stripNegativeAssertions(content)
      : content;
    const lines = scannedContent.split('\n');
    const hits: string[] = [];
    for (const line of lines) {
      for (const deletedPath of DELETED_MIGRATED_PATHS) {
        if (line.includes(deletedPath)) {
          hits.push(rel + ' -> ' + deletedPath);
        }
      }
    }
    return hits;
  }

  it('no active source/doc/shell/test file references a deleted migrated script', () => {
    const offenders: string[] = [];

    // Scan directory roots.
    for (const relRoot of ACTIVE_SCAN_ROOTS) {
      const absRoot = join(repoRoot, relRoot);
      if (!existsDir(absRoot)) continue;
      for (const file of collectScannableFiles(absRoot)) {
        offenders.push(...findStaleReferencesIn(file));
      }
    }

    // Scan root-level contributor docs.
    for (const relFile of ROOT_LEVEL_FILES) {
      offenders.push(...findStaleReferencesIn(join(repoRoot, relFile)));
    }

    const message =
      'Active surfaces reference deleted migrated scripts:' +
      NL +
      offenders.join(NL);
    expect(offenders, message).toEqual([]);
  }, 15_000);
});

describe('Issue #2368: Bun startup does not run the compiled-script build warning', () => {
  const startTsPath = resolve(repoRoot, 'scripts', 'start.ts');
  const startSource = readFileSync(startTsPath, 'utf-8');

  const OBSOLETE_STARTUP_REFERENCES = [
    'check-build-status',
    'llxprt-code-warnings',
    '.last_build',
  ] as const;

  it.each(OBSOLETE_STARTUP_REFERENCES)(
    'scripts/start.ts does not reference %s',
    (obsolete) => {
      expect(startSource).not.toContain(obsolete);
    },
  );

  it('scripts/start.ts does not import execSync (only used by the removed check)', () => {
    expect(startSource).not.toMatch(/\bexecSync\b/);
  });

  it('scripts/start.ts still discovers the sandbox command (unrelated behavior preserved)', () => {
    expect(startSource).toContain('sandbox_command');
  });
});

function findBunExecutableForRuntimeTest(): string {
  if (process.platform === 'win32') {
    return '';
  }
  const result = spawnSync('sh', ['-c', 'command -v bun'], {
    encoding: 'utf-8',
  });
  if (result.error || result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}

const realBunForRuntimeTest = findBunExecutableForRuntimeTest();
if (!realBunForRuntimeTest && process.platform !== 'win32') {
  console.warn(
    '[bun-script-migration.test.ts] Bun executable not found; runtime integration tests for start.ts will be skipped.',
  );
}
const runtimeDescribe = realBunForRuntimeTest ? describe : describe.skip;

runtimeDescribe(
  'Issue #2368: start.ts orchestrates child processes correctly at runtime',
  () => {
    const startTsPath = resolve(repoRoot, 'scripts', 'start.ts');
    const NEWLINE = '\n';

    function setupFakeBinDir(): {
      binDir: string;
      bunLogPath: string;
      nodeLogPath: string;
    } {
      const binDir = mkdtempSync(join(tmpdir(), 'issue2368-fake-bin-'));
      const bunLogPath = join(binDir, 'bun-invocations.log');
      const nodeLogPath = join(binDir, 'node-invocations.log');

      const fakeBunLines = [
        '#!/bin/sh',
        `echo "$@" >> "${bunLogPath}"`,
        'for arg in "$@"; do',
        '  case "$arg" in',
        '    *check-build-status*)',
        '      echo "HARD FAIL: check-build-status was invoked" >&2',
        '      exit 99',
        '      ;;',
        '    *sandbox_command*)',
        '      exit 1',
        '      ;;',
        '  esac',
        'done',
        'exit 0',
      ];
      const fakeBun = fakeBunLines.join(NEWLINE) + NEWLINE;

      const fakeNodeLines = [
        '#!/bin/sh',
        `printf '%s\\n' "$@" >> "${nodeLogPath}"`,
        'exit 0',
      ];
      const fakeNode = fakeNodeLines.join(NEWLINE) + NEWLINE;

      writeFileSync(join(binDir, 'bun'), fakeBun, { mode: 0o755 });
      writeFileSync(join(binDir, 'node'), fakeNode, { mode: 0o755 });

      return { binDir, bunLogPath, nodeLogPath };
    }

    function runStartWithFakeBin(
      binDir: string,
      userArgs: string[],
    ): { status: number; stdout: string; stderr: string } {
      const existingPath = process.env.PATH ?? '';
      const fakePath = binDir + delimiter + existingPath;
      const env: NodeJS.ProcessEnv = {
        PATH: fakePath,
        SANDBOX: '',
        SEATBELT_PROFILE: 'none',
        DEBUG: '',
        ...(process.env.HOME !== undefined ? { HOME: process.env.HOME } : {}),
        ...(process.env.USER !== undefined ? { USER: process.env.USER } : {}),
        ...(process.env.TMPDIR !== undefined
          ? { TMPDIR: process.env.TMPDIR }
          : {}),
      };
      const result = spawnSync(
        realBunForRuntimeTest,
        ['run', startTsPath, ...userArgs],
        {
          cwd: repoRoot,
          env,
          timeout: 30_000,
          encoding: 'utf-8',
        },
      );
      if (result.error) {
        const timeoutMessage = 'start.ts did not exit within 30s';
        const failureMessage = result.error.message.includes('ETIMEDOUT')
          ? timeoutMessage
          : `Failed to spawn start.ts via bun: ${result.error.message}`;
        throw new Error(failureMessage);
      }
      if (result.status === null) {
        throw new Error(
          `start.ts was killed by signal: ${result.signal ?? 'unknown'}. stderr: ${result.stderr ?? ''}`,
        );
      }
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    }

    it('spawns bun with the CLI entry and forwards user args', () => {
      const { binDir, bunLogPath } = setupFakeBinDir();
      try {
        const { status } = runStartWithFakeBin(binDir, ['--version']);
        expect(status).toBe(0);
        const bunArgs = readFileSync(bunLogPath, 'utf-8').trim().split(NEWLINE);
        // start.ts spawns bun for the CLI entry (packages/cli/index.ts) and
        // forwards user args. Assert that SOME bun invocation contains both
        // the entry and --version, without depending on last-match ordering
        // (start.ts may emit multiple bun invocations for discovery).
        const cliWithVersion = bunArgs.filter(
          (line) =>
            line.includes('packages/cli/index.ts') &&
            line.includes('--version'),
        );
        expect(
          cliWithVersion.length,
          `expected a bun invocation containing both the CLI entry and --version; got: ${bunArgs.join(NEWLINE)}`,
        ).toBeGreaterThan(0);
      } finally {
        rmSync(binDir, { recursive: true, force: true });
      }
    });

    it('attempts sandbox command discovery via bun', () => {
      const { binDir, bunLogPath } = setupFakeBinDir();
      try {
        const { status } = runStartWithFakeBin(binDir, []);
        expect(status).toBe(0);
        const bunLog = readFileSync(bunLogPath, 'utf-8');
        const sandboxAttempted = bunLog
          .split(NEWLINE)
          .some((line) => line.includes('sandbox_command'));
        expect(sandboxAttempted).toBe(true);
      } finally {
        rmSync(binDir, { recursive: true, force: true });
      }
    });

    it('never invokes check-build-status', () => {
      const { binDir, bunLogPath } = setupFakeBinDir();
      try {
        const { status } = runStartWithFakeBin(binDir, []);
        expect(status).toBe(0);
        const bunLog = readFileSync(bunLogPath, 'utf-8');
        expect(bunLog).not.toContain('check-build-status');
      } finally {
        rmSync(binDir, { recursive: true, force: true });
      }
    });
  },
);
