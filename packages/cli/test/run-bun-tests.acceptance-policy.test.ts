/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import * as agents from '../../agents/run-bun-tests.js';
import * as cli from '../run-bun-tests.js';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const CHILD = 'src/core/__tests__/childaccept-memory.test.ts';
const CLI = 'src/services/wholememory.test.ts';

it('waits for CLI child pipes to close before releasing the worker slot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-runner-pipe-drain-'));
  const file = join(dir, 'pipe-drain.test.ts');
  writeFileSync(
    file,
    `import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', 'setTimeout(() => console.log("descendant finished"), 300)'], { stdio: 'inherit' });
process.exit(0);
`,
  );
  try {
    const result = await cli.runTestFile(file);
    expect(result.passed).toBe(true);
    expect(result.output).toContain('descendant finished');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

const runners = [
  {
    name: 'agents',
    runner: agents,
    acceptance: CHILD,
    testMs: 7_200_000,
    fileMs: 7_260_000,
  },
  {
    name: 'cli',
    runner: cli,
    acceptance: CLI,
    testMs: 14_400_000,
    fileMs: 14_460_000,
  },
] as const;

for (const { name, runner, acceptance, testMs, fileMs } of runners) {
  describe(`${name} acceptance runner`, () => {
    it('uses exact acceptance budgets and keeps ordinary budgets unchanged', () => {
      const root = join(REPO_ROOT, 'packages', name);
      for (const file of [
        acceptance,
        `./${acceptance}`,
        join(root, acceptance),
        acceptance.replaceAll('/', '\\'),
      ]) {
        expect(runner.timeoutForFile(file)).toBe(testMs);
        expect(runner.fileTimeoutForFile(file)).toBe(fileMs);
      }
      for (const file of [
        `nested/${acceptance}`,
        acceptance.replace('.test.', '.spec.'),
        acceptance.replace('src/', 'test/'),
        `../other/${acceptance}`,
      ]) {
        expect(runner.timeoutForFile(file)).toBe(180_000);
        expect(runner.fileTimeoutForFile(file)).toBe(300_000);
      }
    });

    it('does not shrink acceptance with the short fixture override', () => {
      const saved = process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
      process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = '4000';
      try {
        expect(runner.fileTimeoutForFile(acceptance)).toBe(fileMs);
        expect(runner.fileTimeoutForFile('src/ordinary.test.ts')).toBe(4000);
      } finally {
        restoreTimeout(saved);
      }
    });
  });

  describe(`${name} isolated acceptance scheduling`, () => {
    it('discovers acceptance exactly once and schedules every discovered file', async () => {
      const root = join(REPO_ROOT, 'packages', name);
      const files = runner
        .discoverTestFiles(root)
        .map((file) => (file.startsWith('/') ? relative(root, file) : file));
      expect(files.filter((file) => file === acceptance)).toHaveLength(1);
      const visited: string[] = [];
      await runner.runTestFiles(files, 4, async (file: string) => {
        visited.push(file);
      });
      expect([...visited].sort()).toEqual([...files].sort());
      expect(visited.at(-1)).toBe(acceptance);
    });

    it('drains ordinary workers before acceptance and keeps acceptance alone through retry', async () => {
      const files = [
        acceptance,
        'src/ordinary-a.test.ts',
        `nested/${acceptance}`,
        'src/ordinary-b.test.ts',
      ];
      const active = new Set<string>();
      const events: string[] = [];
      const overlaps: string[][] = [];
      let attempts = 0;
      const results = await runner.runTestFiles(
        files,
        3,
        async (file: string) => {
          active.add(file);
          events.push(`start:${file}`);
          if (file === acceptance) {
            overlaps.push([...active]);
            await runner.runTestFileWithTimeoutRetry(
              file,
              async () => {
                attempts++;
                overlaps.push([...active]);
                await Bun.sleep(5);
                return { timedOut: attempts === 1 };
              },
              () => undefined,
            );
          } else {
            await Bun.sleep(file.endsWith('a.test.ts') ? 30 : 10);
          }
          events.push(`end:${file}`);
          active.delete(file);
          return file;
        },
      );
      expect([...results].sort()).toEqual([...files].sort());
      expect(events.indexOf(`start:${acceptance}`)).toBeGreaterThan(
        events.indexOf('end:src/ordinary-a.test.ts'),
      );
      expect(events.indexOf(`start:${acceptance}`)).toBeGreaterThan(
        events.indexOf(`end:nested/${acceptance}`),
      );
      expect(overlaps).toEqual([[acceptance], [acceptance], [acceptance]]);
      expect(attempts).toBe(2);
    });
  });

  describe(`${name} scheduling errors`, () => {
    it('rejects invalid concurrency before running any file', async () => {
      for (const concurrency of [0, -1, 1.5]) {
        const visited: string[] = [];
        await expect(
          runner.runTestFiles(
            [acceptance],
            concurrency,
            async (file: string) => {
              visited.push(file);
            },
          ),
        ).rejects.toThrow('Test concurrency must be a positive integer');
        expect(visited).toEqual([]);
      }
    });

    it('drains rejected workers and does not start acceptance after a worker error', async () => {
      const ended: string[] = [];
      await expect(
        runner.runTestFiles(
          [acceptance, 'src/error.test.ts', 'src/slow.test.ts'],
          2,
          async (file: string) => {
            if (file.endsWith('error.test.ts'))
              throw new Error('worker failure');
            await Bun.sleep(20);
            ended.push(file);
          },
        ),
      ).rejects.toThrow('worker failure');
      expect(ended).toEqual(['src/slow.test.ts']);
    });
  });
}

function restoreTimeout(saved: string | undefined): void {
  if (saved === undefined) delete process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
  else process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = saved;
}

it('keeps CLI integration budgets unchanged', () => {
  expect(cli.timeoutForFile('src/example.integration.test.ts')).toBe(360_000);
  expect(cli.fileTimeoutForFile('src/example.integration.test.ts')).toBe(
    900_000,
  );
});

for (const { name } of runners) {
  it(`${name} keeps incomplete real timeout red, retries twice, and reaps the process tree`, async () => {
    const dir = mkdtempSync(join(tmpdir(), `${name}-runner-tree-`));
    const file = join(dir, 'incomplete.test.ts');
    const markers = join(dir, 'attempts.jsonl');
    const saved = process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
    writeFileSync(
      file,
      `import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
test('completed prefix', () => { expect(2 + 2).toBe(4); });
test('incomplete acceptance', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
  appendFileSync(${JSON.stringify(markers)}, JSON.stringify([process.pid, child.pid]) + '\\n');
  await Bun.sleep(30_000);
}, 30_000);
`,
    );
    process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = '4000';
    try {
      const run = (): Promise<{ passed: boolean; timedOut: boolean }> =>
        name === 'agents'
          ? agents.runTestFile(file, join(dir, 'report.xml'))
          : cli.runTestFile(file);
      const logs: string[] = [];
      const result = await (
        name === 'agents' ? agents : cli
      ).runTestFileWithTimeoutRetry(file, run, (message) => logs.push(message));
      expect(result.passed).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(logs).toHaveLength(1);
      const attempts: unknown[] = readFileSync(markers, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(attempts).toHaveLength(2);
      if (process.platform !== 'win32') {
        for (const attempt of attempts) {
          if (!Array.isArray(attempt)) throw new Error('invalid PID evidence');
          for (const pid of attempt) {
            if (typeof pid !== 'number') throw new Error('missing child PID');
            expect(() => process.kill(pid, 0)).toThrow();
          }
        }
      }
    } finally {
      restoreTimeout(saved);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it(`${name} does not retry a real ordinary assertion failure`, async () => {
    const dir = mkdtempSync(join(tmpdir(), `${name}-runner-assertion-`));
    const file = join(dir, 'ordinary.test.ts');
    const marker = join(dir, 'attempts.txt');
    writeFileSync(
      file,
      `import { expect, test } from 'bun:test';
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(marker)}, 'attempt\\n');
test('ordinary failure', () => { expect(2 + 2).toBe(5); });
`,
    );
    try {
      const run = (): Promise<{ passed: boolean; timedOut: boolean }> =>
        name === 'agents'
          ? agents.runTestFile(file, join(dir, 'report.xml'))
          : cli.runTestFile(file);
      const logs: string[] = [];
      const result = await (
        name === 'agents' ? agents : cli
      ).runTestFileWithTimeoutRetry(file, run, (message) => logs.push(message));
      expect(result).toMatchObject({ passed: false, timedOut: false });
      expect(readFileSync(marker, 'utf8').trim().split('\n')).toHaveLength(1);
      expect(logs).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
}
