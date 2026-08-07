/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGitHubRepositoryUrl } from './generate-notices.ts';

describe('normalizeGitHubRepositoryUrl', () => {
  it('canonicalizes the deprecated git:// GitHub protocol to https://', () => {
    expect(
      normalizeGitHubRepositoryUrl(
        'git://github.com/beaugunderson/ip-address.git',
      ),
    ).toBe('https://github.com/beaugunderson/ip-address.git');
  });

  it('is idempotent for URLs already on the canonical protocol', () => {
    const canonical = 'https://github.com/isaacs/node-which.git';
    expect(normalizeGitHubRepositoryUrl(canonical)).toBe(canonical);
  });

  it('leaves non-GitHub git:// URLs untouched', () => {
    const other = 'git://example.com/vendor/repo.git';
    expect(normalizeGitHubRepositoryUrl(other)).toBe(other);
  });

  it('leaves the absent-repository sentinel untouched', () => {
    expect(normalizeGitHubRepositoryUrl('No repository found')).toBe(
      'No repository found',
    );
  });

  it('passes non-string values through unchanged instead of throwing', () => {
    expect(normalizeGitHubRepositoryUrl(undefined)).toBeUndefined();
    expect(normalizeGitHubRepositoryUrl(null)).toBeNull();
  });
});

const testDir = path.dirname(fileURLToPath(import.meta.url));
const generatorSrcPath = path.join(testDir, 'generate-notices.ts');
const packageRoot = path.resolve(testDir, '..', '..');

describe('generate-notices full generator behavior', () => {
  function runGeneratorWithFixtures(opts: {
    readonly rootPackageJson: unknown;
    readonly lockfile: unknown;
    readonly deps?: Readonly<
      Record<
        string,
        {
          readonly packageJson: unknown;
          readonly files?: Readonly<Record<string, string>>;
        }
      >
    >;
    readonly fakeNpmScript?: string;
  }): {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly notices: string | null;
  } {
    const tmpDir = mkdtempSync(path.join(packageRoot, '.notices-test-'));
    try {
      const pkgDir = path.join(tmpDir, 'packages', 'vscode-ide-companion');
      const scriptsDir = path.join(pkgDir, 'scripts');
      mkdirSync(scriptsDir, { recursive: true });

      copyFileSync(
        generatorSrcPath,
        path.join(scriptsDir, 'generate-notices.ts'),
      );

      writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify(opts.rootPackageJson),
      );
      writeFileSync(
        path.join(tmpDir, 'package-lock.json'),
        JSON.stringify(opts.lockfile),
      );

      if (opts.deps) {
        for (const [depName, dep] of Object.entries(opts.deps)) {
          const depDir = path.join(pkgDir, 'node_modules', depName);
          mkdirSync(depDir, { recursive: true });
          writeFileSync(
            path.join(depDir, 'package.json'),
            JSON.stringify(dep.packageJson),
          );
          if (dep.files) {
            for (const [fileName, content] of Object.entries(dep.files)) {
              writeFileSync(path.join(depDir, fileName), content);
            }
          }
        }
      }

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') env[k] = v;
      }
      if (opts.fakeNpmScript) {
        const fakeBin = path.join(tmpDir, '.fake-bin');
        mkdirSync(fakeBin, { recursive: true });
        const fakeJsPath = path.join(fakeBin, 'npm.js');
        writeFileSync(fakeJsPath, opts.fakeNpmScript);
        writeFileSync(
          path.join(fakeBin, 'npm'),
          `#!/bin/sh\nbun "${fakeJsPath}" "$@"\n`,
        );
        chmodSync(path.join(fakeBin, 'npm'), 0o755);
        writeFileSync(
          path.join(fakeBin, 'npm.cmd'),
          `@bun "${fakeJsPath}" %*\r\n`,
        );
        env.PATH = fakeBin + path.delimiter + (env.PATH ?? '');
      }

      const noticesPath = path.join(pkgDir, 'NOTICES.txt');
      const result = spawnSync(
        'bun',
        [path.join(scriptsDir, 'generate-notices.ts')],
        {
          env,
          encoding: 'utf-8',
          timeout: 30_000,
        },
      );

      if (result.error) {
        throw new Error(
          `Failed to spawn bun for generate-notices: ${result.error.message}`,
        );
      }

      let notices: string | null = null;
      try {
        notices = readFileSync(noticesPath, 'utf-8');
      } catch {
        notices = null;
      }

      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        notices,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  it('fails fast when root package.json dependencies is not a string record', () => {
    const result = runGeneratorWithFixtures({
      rootPackageJson: {
        name: 'test-pkg',
        dependencies: 'not-a-record',
      },
      lockfile: { packages: {} },
    });

    expect(result.status).toBe(1);
  }, 30_000);

  it('fails fast when a concrete lockfile package entry has no string version', () => {
    const result = runGeneratorWithFixtures({
      rootPackageJson: {
        name: 'test-pkg',
        dependencies: { 'test-dep': '^1.0.0' },
      },
      lockfile: {
        packages: {
          'packages/vscode-ide-companion/node_modules/test-dep': {
            resolved:
              'https://registry.npmjs.org/test-dep/-/test-dep-1.0.0.tgz',
          },
        },
      },
    });

    expect(result.status).toBe(1);
  });

  it('yields the "No repository found" sentinel when package.json repository is a string rather than an object', () => {
    const result = runGeneratorWithFixtures({
      rootPackageJson: {
        name: 'test-pkg',
        dependencies: { 'test-dep': '^1.0.0' },
      },
      lockfile: {
        packages: {
          'packages/vscode-ide-companion/node_modules/test-dep': {
            version: '1.0.0',
            resolved:
              'https://registry.npmjs.org/test-dep/-/test-dep-1.0.0.tgz',
          },
        },
      },
      deps: {
        'test-dep': {
          packageJson: {
            name: 'test-dep',
            version: '1.0.0',
            repository: 'https://github.com/foo/bar',
            license: 'MIT',
          },
          files: {
            LICENSE: 'MIT License\n\nCopyright (c) 2024 Someone\n',
          },
        },
      },
    });

    expect({
      status: result.status,
      hasSentinel: result.notices?.includes('(No repository found)') ?? false,
    }).toEqual({
      status: 0,
      hasSentinel: true,
    });
  });

  it('falls back to current year and warns when npm time has an invalid date', () => {
    const currentYear = String(new Date().getFullYear());
    const result = runGeneratorWithFixtures({
      rootPackageJson: {
        name: 'test-pkg',
        dependencies: { 'test-dep': '^1.0.0' },
      },
      lockfile: {
        packages: {
          'packages/vscode-ide-companion/node_modules/test-dep': {
            version: '1.0.0',
            resolved:
              'https://registry.npmjs.org/test-dep/-/test-dep-1.0.0.tgz',
          },
        },
      },
      deps: {
        'test-dep': {
          packageJson: {
            name: 'test-dep',
            version: '1.0.0',
            license: 'MIT',
            author: 'Someone',
          },
        },
      },
      fakeNpmScript:
        "process.stdout.write(JSON.stringify({ created: 'not-a-valid-date' }));",
    });

    expect({
      status: result.status,
      hasWarning: result.stderr.includes('Warning'),
      includesYear: result.notices?.includes(currentYear) ?? false,
      excludesNaN: !(result.notices?.includes('NaN') ?? true),
    }).toEqual({
      status: 0,
      hasWarning: true,
      includesYear: true,
      excludesNaN: true,
    });
  });
});
