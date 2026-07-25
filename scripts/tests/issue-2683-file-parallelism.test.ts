/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const realConfigPath = join(repoRoot, 'scripts', 'tests', 'vitest.config.ts');
const vitestEntry = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

const BARRIER_MS = 2000;
const HOLD_MS = 500;
const CHILD_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 25_000;

function removeTemporaryDirectory(directory: string): Error | undefined {
  try {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    return undefined;
  } catch (error) {
    const cleanupError =
      error instanceof Error ? error : new Error(String(error));
    process.stderr.write(
      `Failed to remove ${directory}: ${cleanupError.message}\n`,
    );
    return cleanupError;
  }
}

function nestedVitestFailure(result: SpawnSyncReturns<string>): string {
  return `nested vitest exited ${result.status} with signal ${result.signal}\n--- error ---\n${result.error?.message ?? ''}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

function generateWorker(
  name: string,
  other: string,
  sentinelDir: string,
  lockDir: string,
): string {
  return `import { describe, it } from 'vitest';
import { writeFileSync, existsSync, mkdirSync, rmSync, watch } from 'node:fs';
import { join } from 'node:path';

async function crossBarrier(readyOther) {
  if (existsSync(readyOther)) return;
  await new Promise((resolve) => {
    let watcher;
    let timer;
    const finish = () => {
      watcher?.close();
      if (timer) clearTimeout(timer);
      resolve();
    };
    watcher = watch(${JSON.stringify(sentinelDir)}, () => {
      if (existsSync(readyOther)) finish();
    });
    timer = setTimeout(finish, ${BARRIER_MS});
    if (existsSync(readyOther)) finish();
  });
}

describe('worker-${name}', () => {
  it('acquires an exclusive lock after a barrier', async () => {
    const readySelf = join(${JSON.stringify(sentinelDir)}, '${name}.ready');
    const readyOther = join(${JSON.stringify(sentinelDir)}, '${other}.ready');
    writeFileSync(readySelf, '');
    await crossBarrier(readyOther);
    mkdirSync(${JSON.stringify(lockDir)});
    try {
      await new Promise((r) => setTimeout(r, ${HOLD_MS}));
    } finally {
      rmSync(${JSON.stringify(lockDir)}, { recursive: true, force: true });
    }
  });
});
`;
}

describe('issue #2683: scripts/tests file parallelism', () => {
  it(
    'serializes test files so exclusive locks never collide',
    () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'issue2683-'));
      const cleanupErrors: Error[] = [];
      let projectDir: string | undefined;
      let result: SpawnSyncReturns<string> | undefined;
      try {
        projectDir = mkdtempSync(join(repoRoot, '.issue2683-'));
        const sentinelDir = join(tempDir, 'sentinels');
        const lockDir = join(tempDir, 'lock');
        mkdirSync(sentinelDir, { recursive: true });
        mkdirSync(join(projectDir, 'tests'), { recursive: true });
        writeFileSync(
          join(projectDir, 'tests', 'worker-a.test.ts'),
          generateWorker('a', 'b', sentinelDir, lockDir),
        );
        writeFileSync(
          join(projectDir, 'tests', 'worker-b.test.ts'),
          generateWorker('b', 'a', sentinelDir, lockDir),
        );

        const configPath = join(projectDir, 'vitest.config.ts');
        writeFileSync(
          configPath,
          `import { defineConfig } from 'vitest/config';
import realConfig from ${JSON.stringify(realConfigPath)};

const baseTest = (realConfig && realConfig.test) || {};

export default defineConfig({
  test: {
    ...baseTest,
    include: ['tests/**/*.test.ts'],
    setupFiles: [],
    globals: false,
    root: ${JSON.stringify(projectDir)},
    minWorkers: 2,
    maxWorkers: 2,
  },
});
`,
        );

        result = spawnSync(
          process.execPath,
          [vitestEntry, 'run', '--config', configPath, '--no-color'],
          { cwd: projectDir, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS },
        );
      } finally {
        if (projectDir) {
          const projectCleanupError = removeTemporaryDirectory(projectDir);
          if (projectCleanupError) {
            cleanupErrors.push(projectCleanupError);
          }
        }
        const tempCleanupError = removeTemporaryDirectory(tempDir);
        if (tempCleanupError) {
          cleanupErrors.push(tempCleanupError);
        }
      }

      if (!result) {
        throw new Error('Nested Vitest did not return a result');
      }
      expect(
        {
          status: result.status,
          cleanupErrors: cleanupErrors.map((error) => error.message),
        },
        nestedVitestFailure(result),
      ).toEqual({ status: 0, cleanupErrors: [] });
    },
    TEST_TIMEOUT_MS,
  );
});
