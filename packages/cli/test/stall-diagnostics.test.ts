/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A test file that finishes its assertions but keeps its process alive used to
 * be killed with no record of what held it. These tests pin the two halves of
 * the report that now precedes that kill, and the render teardown that must
 * surface a render it could not dispose.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePsTable,
  parseTabSeparatedTable,
  selectDescendants,
} from '../runner-stall-inspector.js';
import { runTestFile } from '../run-bun-tests.js';
import {
  cleanup,
  registerRender,
  type RegisteredRender,
} from '../test-utils/ink-render-registry.js';
import {
  buildStallReport,
  describeHandle,
} from '../test-utils/stall-report.js';

describe('process table parsing', () => {
  it('reads ps rows with a multi-word command line', () => {
    const rows = parsePsTable(
      '  100     1 bun        /usr/bin/bun test a.test.ts\n  205   100 node       node child.js --flag\n',
    );
    expect(rows).toEqual([
      {
        pid: 100,
        ppid: 1,
        name: 'bun',
        commandLine: '/usr/bin/bun test a.test.ts',
      },
      {
        pid: 205,
        ppid: 100,
        name: 'node',
        commandLine: 'node child.js --flag',
      },
    ]);
  });

  it('reads tab separated rows and skips non-row lines', () => {
    const rows = parseTabSeparatedTable(
      '4\t0\tbun.exe\tbun.exe test x\r\n\r\nnot a row\r\n8\t4\tconhost.exe\t\r\n',
    );
    expect(rows).toEqual([
      { pid: 4, ppid: 0, name: 'bun.exe', commandLine: 'bun.exe test x' },
      { pid: 8, ppid: 4, name: 'conhost.exe', commandLine: '' },
    ]);
  });
});

describe('selectDescendants', () => {
  const row = (pid: number, ppid: number) => ({
    pid,
    ppid,
    name: `p${pid}`,
    commandLine: '',
  });

  it('returns every level below the root and nothing else', () => {
    const rows = [
      row(10, 1),
      row(11, 10),
      row(12, 11),
      row(13, 10),
      row(20, 2),
    ];
    expect(selectDescendants(rows, 10).map((entry) => entry.pid)).toEqual([
      11, 13, 12,
    ]);
  });

  it('terminates on a parent cycle', () => {
    const rows = [row(10, 12), row(11, 10), row(12, 11)];
    expect(selectDescendants(rows, 10).map((entry) => entry.pid)).toEqual([
      11, 12,
    ]);
  });
});

describe('buildStallReport', () => {
  it('names the process, its listeners and the real stdin state', () => {
    const report = buildStallReport();
    expect(report).toContain(`pid=${process.pid}`);
    expect(report).toContain('active handles (');
    expect(report).toContain('process listeners:');
    expect(report).toContain('process.stdin: isTTY=');
  });

  it('describes a handle by class and primitive fields only', () => {
    class FakeSocket {
      fd = 7;
      isTTY = false;
      nested = { large: 'structure' };
    }
    expect(describeHandle(new FakeSocket())).toBe(
      'FakeSocket fd=7 isTTY=false',
    );
  });
});

describe('render registry cleanup', () => {
  it('tears down every render and then reports the one that failed', () => {
    const calls: string[] = [];
    const failing: RegisteredRender = {
      unmount: () => {
        calls.push('failing.unmount');
        throw new Error('unmount failed');
      },
      cleanup: () => calls.push('failing.cleanup'),
    };
    const healthy: RegisteredRender = {
      unmount: () => calls.push('healthy.unmount'),
      cleanup: () => calls.push('healthy.cleanup'),
    };
    const stdin = {} as NodeJS.ReadStream;
    registerRender(failing, stdin);
    registerRender(healthy, stdin);

    expect(() => cleanup()).toThrow('unmount failed');
    expect(calls).toEqual([
      'failing.unmount',
      'failing.cleanup',
      'healthy.unmount',
      'healthy.cleanup',
    ]);
    // Everything was released, so a second pass has nothing to report.
    expect(() => cleanup()).not.toThrow();
  });

  it('aggregates when several teardown steps fail', () => {
    const broken: RegisteredRender = {
      unmount: () => {
        throw new Error('first');
      },
      cleanup: () => {
        throw new Error('second');
      },
    };
    registerRender(broken, {} as NodeJS.ReadStream);

    let thrown: unknown;
    try {
      cleanup();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map(String)).toEqual([
      'Error: first',
      'Error: second',
    ]);
  });
});

describe('a file that finishes its tests but does not exit', () => {
  it('has its own report printed before it is killed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-stall-report-'));
    const logged: string[] = [];
    const log = spyOn(console, 'error').mockImplementation(
      (message: unknown) => {
        logged.push(String(message));
      },
    );
    const savedBudget = process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
    try {
      const file = join(dir, 'staysAlive.test.ts');
      writeFileSync(
        file,
        `import { expect, test } from 'bun:test';

// Bun force-exits once its tests are done, so a real post-summary stall cannot
// be staged from a portable fixture. Print the summary line the runner keys on
// and then stay in the test instead: the runner sees "tests finished, still
// running", and the process is alive to answer the report request.
test('prints its summary and then does not return', async () => {
  console.log('Ran 1 test across 1 file. [0.01s]');
  await Bun.sleep(60_000);
});
`,
      );
      // Long enough for a loaded child to start and print its summary line.
      process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = '6000';
      const result = await runTestFile(file);

      expect(result.timedOut).toBe(true);
      const report = logged.find((entry) =>
        entry.startsWith('STALL DIAGNOSTICS'),
      );
      expect(report).toBeDefined();
      expect(report).toContain(`staysAlive.test.ts (child pid `);
      expect(report).toContain('preload-installed');
      expect(report).toContain('child report:\npid=');
      expect(report).toContain('process.stdin: isTTY=');
      expect(report).toContain('descendant processes:');
    } finally {
      log.mockRestore();
      if (savedBudget === undefined) {
        delete process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
      } else {
        process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = savedBudget;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
