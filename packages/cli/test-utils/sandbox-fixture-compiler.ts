/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const FIXTURE_TIMEOUT_MS = 30_000;

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const BUN_BUILD_INTERMEDIATE_PATTERN = /^\.[0-9a-f]+-00000000\.bun-build$/i;

export function rootBunBuildIntermediatePaths(): ReadonlySet<string> {
  return new Set(
    fs
      .readdirSync(REPOSITORY_ROOT, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && BUN_BUILD_INTERMEDIATE_PATTERN.test(entry.name),
      )
      .map((entry) => path.join(REPOSITORY_ROOT, entry.name)),
  );
}

export function removeNewRootBunBuildIntermediates(
  existingPaths: ReadonlySet<string>,
): void {
  for (const artifactPath of rootBunBuildIntermediatePaths()) {
    if (!existingPaths.has(artifactPath)) {
      fs.rmSync(artifactPath, { force: true });
    }
  }
}

export function fixtureExecutablePath(
  fixtureDir: string,
  commandName: string,
): string {
  return path.join(
    fixtureDir,
    process.platform === 'win32' ? `${commandName}.exe` : commandName,
  );
}

export function writePortableExecutable(
  commandName: string,
  source: string,
  fixtureDir: string,
): void {
  const executablePath = fixtureExecutablePath(fixtureDir, commandName);
  const executableName = path.basename(executablePath);
  const sourcePath = path.join(fixtureDir, `${commandName}.fixture.ts`);
  const existingBuildIntermediates = rootBunBuildIntermediatePaths();
  fs.writeFileSync(sourcePath, source);
  try {
    const compilation = spawnSync(
      process.execPath,
      ['build', '--compile', sourcePath, '--outfile', executablePath],
      {
        cwd: fixtureDir,
        encoding: 'utf8',
        timeout: FIXTURE_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    if (compilation.error !== undefined || compilation.status !== 0) {
      const diagnostic = [
        `Failed to compile ${executableName}.`,
        `status: ${String(compilation.status)}`,
        `stdout: ${JSON.stringify(compilation.stdout)}`,
        `stderr: ${JSON.stringify(compilation.stderr)}`,
      ].join('\n');
      if (compilation.error !== undefined) {
        throw new Error(`${diagnostic}\nerror: ${compilation.error.message}`, {
          cause: compilation.error,
        });
      }
      throw new Error(diagnostic);
    }
  } finally {
    fs.rmSync(sourcePath, { force: true });
    removeNewRootBunBuildIntermediates(existingBuildIntermediates);
  }
}

// The first launch of a freshly compiled executable is slow on macOS (about 1 s
// unloaded, tens of seconds under load) because the OS assesses it once. Run it
// once here so that cost cannot land inside a production deadline in a test.
export function warmCompiledFixture(
  executablePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): void {
  const name = path.basename(executablePath);
  const warmup = spawnSync(executablePath, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: FIXTURE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (warmup.error !== undefined) throw warmup.error;
  if (warmup.status !== 0) {
    throw new Error(`Failed to warm ${name}: ${warmup.stderr.trim()}`);
  }
}

export function removeFixtureDirectory(fixtureDir: string): void {
  if (fixtureDir === '') return;
  fs.rmSync(fixtureDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
