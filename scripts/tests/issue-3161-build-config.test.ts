/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

function run(command: readonly string[], cwd: string): void {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output =
    (result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '');
  expect(result.exitCode, output).toBe(0);
}

function emittedFiles(outputDirectory: string): readonly string[] {
  return readdirSync(outputDirectory, { recursive: true, encoding: 'utf8' });
}

function expectNoTestArtifacts(outputDirectory: string): void {
  const testArtifacts = emittedFiles(outputDirectory).filter((entry) =>
    /(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(entry),
  );
  expect(testArtifacts).toEqual([]);
}

describe('issue #3161 production build configs', () => {
  it('LSP recreates runtime and declaration output after only dist is removed', () => {
    const root = mkdtempSync(join(tmpdir(), 'issue3161-lsp-build-'));
    const packageDirectory = join(root, 'packages', 'lsp');
    try {
      mkdirSync(join(root, 'packages'), { recursive: true });
      copyFileSync(
        join(repoRoot, 'tsconfig.json'),
        join(root, 'tsconfig.json'),
      );
      copyFileSync(
        join(repoRoot, 'bun-test-corrections.d.ts'),
        join(root, 'bun-test-corrections.d.ts'),
      );
      cpSync(join(repoRoot, 'packages', 'lsp'), packageDirectory, {
        recursive: true,
        filter: (source) =>
          basename(source) !== 'dist' && !source.endsWith('.tsbuildinfo'),
      });
      symlinkSync(
        join(repoRoot, 'node_modules'),
        join(root, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      run(['bun', 'run', 'build'], packageDirectory);
      expect(existsSync(join(packageDirectory, 'dist', 'main.js'))).toBe(true);
      expect(existsSync(join(packageDirectory, 'dist', 'main.d.ts'))).toBe(
        true,
      );
      expectNoTestArtifacts(join(packageDirectory, 'dist'));

      rmSync(join(packageDirectory, 'dist'), { recursive: true, force: true });
      run(['bun', 'run', 'build'], packageDirectory);
      expect(existsSync(join(packageDirectory, 'dist', 'main.js'))).toBe(true);
      expect(existsSync(join(packageDirectory, 'dist', 'main.d.ts'))).toBe(
        true,
      );
      expectNoTestArtifacts(join(packageDirectory, 'dist'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('A2A emits runtime and declarations without test artifacts on repeated disposable builds', () => {
    const disposableRoot = join(repoRoot, 'tmp');
    mkdirSync(disposableRoot, { recursive: true });
    const root = mkdtempSync(join(disposableRoot, 'issue3161-a2a-build-'));
    const outputDirectory = join(root, 'dist');
    const configPath = join(root, 'tsconfig.json');
    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          extends: join(
            repoRoot,
            'packages',
            'a2a-server',
            'tsconfig.build.json',
          ),
          compilerOptions: {
            incremental: false,
            outDir: outputDirectory,
          },
        }),
      );

      for (let build = 0; build < 2; build++) {
        rmSync(outputDirectory, { recursive: true, force: true });
        run(['bun', 'x', 'tsc', '--project', configPath], repoRoot);
        expect(
          existsSync(join(outputDirectory, 'a2a-server', 'index.js')),
        ).toBe(true);
        expect(
          existsSync(join(outputDirectory, 'a2a-server', 'index.d.ts')),
        ).toBe(true);
        expectNoTestArtifacts(outputDirectory);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
