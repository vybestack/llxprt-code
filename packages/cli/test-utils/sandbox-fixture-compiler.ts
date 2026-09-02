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

export function writePortableExecutable(
  commandName: string,
  source: string,
  fixtureDir: string,
): void {
  const executableName =
    process.platform === 'win32' ? `${commandName}.exe` : commandName;
  const executablePath = path.join(fixtureDir, executableName);
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

export function removeFixtureDirectory(fixtureDir: string): void {
  if (fixtureDir === '') return;
  fs.rmSync(fixtureDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
