/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P07
 * @requirement:HOOK-061,HOOK-063,HOOK-064,HOOK-065,HOOK-066,HOOK-067a,HOOK-067b,HOOK-068,HOOK-070
 * @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md
 */

import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { Mock } from 'bun:test';
import { spawn } from 'node:child_process';
import { HookEventName } from './types.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookRunner as HookRunnerInstance } from './hookRunner.js';
import type { MockChildProcessWithoutNullStreams } from './hookRunner-test-helpers.js';

const realDebugModule = { ...(await import('../debug/index.js')) };

function restoreHookRunnerGlobals(): void {
  restoreGlobals();
}

// Mock child_process with sync importOriginal for partial mocking
const __actual = { ...(await import('node:child_process')) };
const spawnMock = vi.fn(__actual.spawn);
void vi.mock('node:child_process', () => {
  const actual = __actual as typeof import('node:child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

// Mock debugLogger using vi.hoisted
const mockDebugLogger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

void vi.mock('../debug/index.js', () => {
  // Create a constructor function that returns the mock
  const DebugLogger = vi.fn().mockImplementation(() => mockDebugLogger);
  // Add getLogger as a static method
  DebugLogger.getLogger = vi.fn().mockReturnValue(mockDebugLogger);

  return {
    ...realDebugModule,
    DebugLogger,
  };
});

// Mock console methods
const mockConsole = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

setGlobal('console', mockConsole);

// Dynamic import AFTER vi.mock calls so mocks are applied.
const { HookRunner } = await import('./hookRunner.js');
const {
  configureRunnerTests,
  registerExecuteHookTests,
  registerParallelTests,
  registerSequentialTests,
  registerInvalidJsonTests,
} = await import('./hookRunner-legacy-test-helpers.js');
const {
  rich,
  large,
  command,
  fixture,
  input,
  createMockSpawn,
  mockInput,
  mockConfig,
  registerInputParity,
  registerInputFailures,
  registerCancellationInputTest,
} = await import('./hookRunner-test-helpers.js');

let hookRunner: HookRunnerInstance;

let mockSpawn: MockChildProcessWithoutNullStreams;

function setupRunner(): void {
  vi.resetAllMocks();

  hookRunner = new HookRunner(mockConfig);

  mockSpawn = createMockSpawn();
  configureRunnerTests(hookRunner, mockSpawn, mockDebugLogger, spawnMock);

  (spawn as Mock<typeof spawn>).mockReturnValue(mockSpawn);
}

function teardownRunner(): void {
  vi.restoreAllMocks();
  restoreHookRunnerGlobals();
}

describe('HookRunner', () => {
  beforeEach(setupRunner);
  afterEach(teardownRunner);
  registerDiskSourceTests();
  registerExecuteHookTests();
  registerParallelTests();
  registerSequentialTests();
  registerInvalidJsonTests();
});

function registerDiskSourceTests(): void {
  describe('disk-source command input', () => {
    registerDiskOutputLifecycleTests();
    beforeEach(() => {
      spawnMock.mockImplementation(__actual.spawn);
    });

    registerInputParity(() => hookRunner);
    it('preserves legacy real child receipt', async () => {
      await fixture([], async (_snapshot, _owners, root) => {
        const result = await hookRunner.executeHook(
          command("process.stdout.write('receipt')"),
          HookEventName.BeforeModel,
          { ...mockInput, cwd: root },
        );
        expect(result.stdout).toBe('receipt');
      });
    });
    registerDiskOutputTests();
    registerCancellationInputTest(() => hookRunner);

    registerInputFailures(() => hookRunner);

    it('closes a real command on disk reader failure', async () => {
      await fixture([rich], async (snapshot, owners, root) => {
        snapshot.close();
        const result = await hookRunner.executeHookWithRequestRows(
          command('setInterval(() => {}, 1000)'),
          HookEventName.BeforeModel,
          input(mockInput, snapshot, root, HookEventName.BeforeModel),
        );
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('snapshot is closed');
        result.dispose();
        expect(owners.snapshot().liveRows).toBe(0);
      });
    });
  });
}

function registerDiskOutputTests(): void {
  describe('disk output contract', () => {
    for (const rows of [
      Array.from({ length: 64 }, (_, index) => ({
        ...rich,
        metadata: { ...rich.metadata, id: `replacement-${index}` },
      })),
      [large],
    ]) {
      it(`reads ${rows.length} distinct fragmented replacement rows independently`, async () => {
        await fixture([], async (snapshot, _owners, root) => {
          writeFileSync(
            join(root, 'response.json'),
            JSON.stringify({
              decision: 'allow',
              hookSpecificOutput: {
                llm_request: { version: 2, contents: rows },
              },
            }),
          );
          const result = await hookRunner.executeHookWithRequestRows(
            command(`(async () => {
              require('node:fs').writeFileSync('output-child-started', 'started');
              for await (const _ of process.stdin) {}
              const fs=require('node:fs'), fd=fs.openSync('response.json','r');
              fs.writeFileSync('output-child-input-finished','yes');
              const chunk=Buffer.alloc(8191); let n, total=0;
              fs.writeFileSync('output-child-size',JSON.stringify({size:fs.fstatSync(fd).size, node:process.execPath, options:process.env.NODE_OPTIONS}));
              while ((n=fs.readSync(fd,chunk,0,chunk.length,null))>0) {
                total+=n; await new Promise(r=>process.stdout.write(chunk.subarray(0,n),r));
              }
              fs.writeFileSync('output-child-output-finished',JSON.stringify({total,n}));
            })();`),
            HookEventName.BeforeModel,
            input(mockInput, snapshot, root, HookEventName.BeforeModel),
          );
          try {
            expect(result.success).toBe(true);
            expect(result.stdout.readText().length).toBe(
              readFileSync(join(root, 'response.json'), 'utf8').length,
            );
            expect(result.output?.replacement?.count).toBe(rows.length);
            expect(() => result.output?.readValue([])).toThrow('field or row');
            expect(() =>
              result.output?.readValue(['hookSpecificOutput']),
            ).toThrow('field or row');
            const controller = new AbortController();
            const cancelled = result.output?.replacement?.openReader(
              controller.signal,
            );
            await cancelled?.next();
            controller.abort(new Error('reader cancelled'));
            await expect(cancelled?.next()).rejects.toThrow('reader cancelled');
            const first = result.output?.replacement?.openReader();
            const second = result.output?.replacement?.openReader();
            expect(first).toBeDefined();
            expect(second).toBeDefined();
            for (const row of rows) {
              const expected = JSON.parse(JSON.stringify(row));
              expect((await first?.next())?.value).toStrictEqual(expected);
              expect((await second?.next())?.value).toStrictEqual(expected);
            }
            expect((await first?.next())?.done).toBe(true);
            expect((await second?.next())?.done).toBe(true);
            const abandoned = result.output?.replacement?.openReader();
            await abandoned?.next();
            result.dispose();
            await expect(abandoned?.next()).rejects.toThrow('disposed');
            expect(() => result.output?.replacement?.openReader()).toThrow(
              'disposed',
            );
          } finally {
            result.dispose();
          }
        });
      });
    }
    registerDiskOutputSyntaxTests();
  });
}

function diskOutputSyntaxCases(): Array<
  [string, string, number | undefined, string | undefined]
> {
  const row = JSON.stringify(rich);
  return [
    [
      'JavaScript trim margins',
      `\ufeff\u00a0{"hookSpecificOutput":{"llm_request":{"contents":[${row}]}}}\u2028`,
      1,
      undefined,
    ],
    [
      'inner margins are not trimmed',
      JSON.stringify(
        `\ufeff{"hookSpecificOutput":{"llm_request":{"contents":[${row}]}}}`,
      ),
      undefined,
      'allow',
    ],
    ...extraDiskSyntaxCases(row),
    [
      'escaped keys',
      `{"hookSpecificOutput":{"llm_request":{"cont\\u0065nts":[${row}]}}}`,
      1,
      undefined,
    ],
    [
      'duplicates',
      `{"hookSpecificOutput":{"llm_request":{"contents":[${row}],"contents":[]}}}`,
      0,
      undefined,
    ],
    [
      'duplicate parents',
      `{"hookSpecificOutput":{"llm_request":{"contents":[${row}]}},"hookSpecificOutput":{}}`,
      undefined,
      undefined,
    ],
    [
      'wrong type last',
      `{"hookSpecificOutput":{"llm_request":{"contents":[],"contents":"wrong"}}}`,
      undefined,
      undefined,
    ],
    [
      'nested decoy',
      `{"decoy":{"hookSpecificOutput":{"llm_request":{"contents":[${row}]}}}}`,
      undefined,
      undefined,
    ],
    [
      'empty',
      '{"hookSpecificOutput":{"llm_request":{"contents":[]}}}',
      0,
      undefined,
    ],
    [
      'trailing malformed',
      `{"hookSpecificOutput":{"llm_request":{"contents":[${row}]}}} trailing`,
      undefined,
      'allow',
    ],
    ['plain text', '  plain 雪 😀  ', undefined, 'allow'],
    [
      'double encoded',
      JSON.stringify(
        `{"decision":"deny","hookSpecificOutput":{"llm_request":{"contents":[${row}]}}}`,
      ),
      1,
      'deny',
    ],
  ];
}

function registerDiskOutputSyntaxTests(): void {
  describe('output syntax', () => {
    for (const [label, text, count, decision] of diskOutputSyntaxCases()) {
      it(`publishes exact semantics for ${label}`, async () => {
        await fixture([], async (snapshot, _owners, root) => {
          writeFileSync(join(root, 'response.json'), text);
          const result = await hookRunner.executeHookWithRequestRows(
            command(`(async()=>{for await(const _ of process.stdin){};
            const b=require('node:fs').readFileSync('response.json');
            for(let i=0;i<b.length;i++) await new Promise(r=>process.stdout.write(b.subarray(i,i+1),r));
          })();`),
            HookEventName.BeforeModel,
            input(mockInput, snapshot, root, HookEventName.BeforeModel),
          );
          try {
            expect(result.output?.replacement?.count).toBe(count);
            expect(result.output?.readValue(['decision'])).toBe(decision);
            expect(result.stdout.readText()).toBe(text);
            const expectedText = decision === 'allow' ? text.trim() : undefined;
            expect(result.output?.readValue(['systemMessage'])).toBe(
              expectedText,
            );
            const reader = result.output?.replacement?.openReader();
            const decoded = (await reader?.next())?.value;
            expect(JSON.stringify(decoded)).toBe(
              count === 1 ? JSON.stringify(rich) : undefined,
            );
            await reader?.return();
          } finally {
            result.dispose();
          }
        });
      });
    }
  });
}

function registerDiskOutputLifecycleTests(): void {
  describe('disk output lifecycle', () => {
    registerDiskExitTests();
    registerDiskOutputStopTests();
    registerLargeDiskOutputTests();
    registerDiskMergeTest();
  });
}
function registerLargeDiskOutputTests(): void {
  describe('large output and disk failure', () => {
    it('does not impose the metadata projection token limit', async () => {
      await fixture([], async (snapshot, _owners, root) => {
        const result = await hookRunner.executeHookWithRequestRows(
          command(`(async()=>{
          for await(const _ of process.stdin){}
          const put=s=>new Promise(r=>process.stdout.write(s,r));
          await put('{"ignored":"');
          for(let i=0;i<17;i++) await put('z'.repeat(1024*1024));
          await put('","hookSpecificOutput":{"llm_request":{"contents":[{"speaker":"human","blocks":[{"type":"text","text":"');
          for(let i=0;i<17;i++) await put('x'.repeat(1024*1024));
          await put('尾"}]}]}}}');
        })();`),
          HookEventName.BeforeModel,
          input(mockInput, snapshot, root, HookEventName.BeforeModel),
        );
        try {
          expect(result.success).toBe(true);
          const reader = result.output?.replacement?.openReader();
          const row = (await reader?.next())?.value;
          expect(row).toMatchObject({ speaker: 'human' });
          expect(JSON.stringify(row).length).toBeGreaterThan(17 * 1024 * 1024);
          await reader?.return();
        } finally {
          result.dispose();
        }
      });
    });
    it('rejects disk I/O failure rather than treating it as invalid JSON', async () => {
      await fixture([], async (snapshot, _owners, root) => {
        await expect(
          hookRunner.executeHookWithRequestRows(
            command(`(async()=>{
          for await(const _ of process.stdin){}
          const fs=require('node:fs');
          const dir=fs.readdirSync('.').find(n=>n.startsWith('hook-output-'));
          fs.mkdirSync(dir+'/document.utf16');
          process.stdout.write('{"decision":"allow"}');
        })();`),
            HookEventName.BeforeModel,
            input(mockInput, snapshot, root, HookEventName.BeforeModel),
          ),
        ).rejects.toThrow('EISDIR');
      });
    });
  });
}
function registerDiskMergeTest(): void {
  describe('sequential disk output', () => {
    it('merges a disk replacement into the next real hook without collecting its rows', async () => {
      await fixture([], async (snapshot, _owners, root) => {
        const source = input(
          mockInput,
          snapshot,
          root,
          HookEventName.BeforeModel,
        );
        writeFileSync(
          join(root, 'response.json'),
          JSON.stringify({
            hookSpecificOutput: {
              llm_request: {
                contents: [rich],
                model: 'next',
                tools: [],
                settings: { top_p: 0.2 },
              },
            },
          }),
        );
        const first = await hookRunner.executeHookWithRequestRows(
          command(
            `(async()=>{for await(const _ of process.stdin){};process.stdout.write(require('node:fs').readFileSync('response.json'));})();`,
          ),
          HookEventName.BeforeModel,
          source,
        );
        try {
          const request = first.output?.mergeRequestRows(source.llm_request);
          expect(request).toBeDefined();
          if (request === undefined) throw new Error('Missing merged request');
          const second = await hookRunner.executeHookWithRequestRows(
            command(`(async()=>{
            let b='';for await(const c of process.stdin)b+=c;
            const q=JSON.parse(b).llm_request;
            process.stdout.write(JSON.stringify({systemMessage:JSON.stringify({count:q.contents.length,id:q.contents[0].metadata.id,model:q.model,tools:q.tools,settings:q.settings})}));
          })();`),
            HookEventName.BeforeModel,
            { ...source, llm_request: request },
          );
          try {
            expect(
              JSON.parse(String(second.output?.readValue(['systemMessage']))),
            ).toStrictEqual({
              count: 1,
              id: 'rich',
              model: 'next',
              tools: [],
              settings: { temperature: 0, top_p: 0.2 },
            });
          } finally {
            second.dispose();
          }
        } finally {
          first.dispose();
        }
      });
    });
  });
}

function registerDiskExitTests(): void {
  describe('registerDiskExitTests', () => {
    for (const [code, message, decision, field, value] of [
      [
        1,
        '  failure 雪 😀  ',
        'allow',
        'systemMessage',
        'Warning: failure 雪 😀',
      ],
      [
        2,
        '',
        'deny',
        'reason',
        'Hook exited with code 2 without an error message',
      ],
      [2, '  denied 雪 😀  ', 'deny', 'reason', 'denied 雪 😀'],
    ] satisfies Array<[number, string, string, string, string]>) {
      it(`preserves exit ${code} and its stderr message`, async () => {
        await fixture([], async (snapshot, _owners, root) => {
          const result = await hookRunner.executeHookWithRequestRows(
            command(
              `(async()=>{for await(const _ of process.stdin){};process.stdout.write('{"decision":"allow"}');await new Promise(r=>process.stderr.write(${JSON.stringify(message)},r));process.exit(${code});})();`,
            ),
            HookEventName.BeforeModel,
            input(mockInput, snapshot, root, HookEventName.BeforeModel),
          );
          try {
            expect(result.success).toBe(false);
            expect(result.exitCode).toBe(code);
            expect(result.stderr.readText()).toBe(message);
            expect(result.output?.readValue(['decision'])).toBe(decision);
            expect(result.output?.readValue([field])).toBe(value);
            expect(result.output?.replacement).toBeUndefined();
          } finally {
            result.dispose();
          }
        });
      });
    }
  });
}
function registerDiskOutputStopTests(): void {
  describe('registerDiskOutputStopTests', () => {
    for (const mode of ['cancel', 'timeout']) {
      it(`preserves partial output and stderr on output-side ${mode}`, async () => {
        await fixture([], async (snapshot, _owners, root) => {
          const controller = new AbortController();
          const reason = new Error('cancel hook output');
          const source = input(
            mockInput,
            snapshot,
            root,
            HookEventName.BeforeModel,
          );
          const hook = command(`(async()=>{
          for await(const _ of process.stdin){}
          await new Promise(r=>process.stdout.write('{"hookSpecificOutput":{"llm_request":{"contents":[',r));
          await new Promise(r=>process.stderr.write('  progress 雪 😀  ',r));
          require('node:fs').writeFileSync('output-ready',String(process.pid));
          setInterval(()=>{},1000);
        })();`);
          const pending = hookRunner.executeHookWithRequestRows(
            { ...hook, timeout: mode === 'timeout' ? 250 : 10000 },
            HookEventName.BeforeModel,
            source,
            controller.signal,
          );
          if (mode === 'cancel') {
            while (!existsSync(join(root, 'output-ready')))
              await new Promise((r) => setTimeout(r, 5));
            controller.abort(reason);
          }
          const result = await pending;
          try {
            expect(result.success).toBe(false);
            expect(result.error?.message).toBe(
              mode === 'cancel' ? reason.message : 'Hook timed out after 250ms',
            );
            expect(result.error === reason).toBe(mode === 'cancel');
            expect(result.stdout.readText()).toBe(
              '{"hookSpecificOutput":{"llm_request":{"contents":[',
            );
            expect(result.stderr.readText()).toBe('  progress 雪 😀  ');
            expect(result.output?.replacement).toBeUndefined();
            expect(result.output?.readValue(['systemMessage'])).toBe(
              mode === 'cancel' ? 'Warning: progress 雪 😀' : undefined,
            );
            expect(result.output === undefined).toBe(mode === 'timeout');
            const pid = Number(
              readFileSync(join(root, 'output-ready'), 'utf8'),
            );
            expect(() => process.kill(pid, 0)).toThrow('ESRCH');
          } finally {
            result.dispose();
          }
        });
      });
    }
  });
}

function extraDiskSyntaxCases(
  row: string,
): Array<[string, string, number | undefined, string | undefined]> {
  return [
    [
      'last array replaces rows',
      `{"hookSpecificOutput":{"llm_request":{"contents":[{"speaker":"human","blocks":[]}],"contents":[${row}]}}}`,
      1,
      undefined,
    ],
    [
      'last request is null',
      `{"hookSpecificOutput":{"llm_request":{"contents":[${row}]},"llm_request":null}}`,
      undefined,
      undefined,
    ],
    [
      'last request replaces rows',
      `{"hookSpecificOutput":{"llm_request":{"contents":[]},"llm_request":{"contents":[${row}]}}}`,
      1,
      undefined,
    ],
    [
      'wrong first type then array',
      '{"hookSpecificOutput":{"llm_request":{"contents":false,"contents":[]}}}',
      0,
      undefined,
    ],
    [
      'malformed ignored field',
      `{"hookSpecificOutput":{"llm_request":{"contents":[${row}]}},"ignored":[1,]}`,
      undefined,
      'allow',
    ],
    [
      'double encoded lone surrogate',
      JSON.stringify(
        `{"hookSpecificOutput":{"llm_request":{"contents":[${row.replace('\\ud800', '\ud800')}]}}}`,
      ),
      1,
      undefined,
    ],
    [
      'double encoded invalid inner text',
      JSON.stringify('not JSON 雪'),
      undefined,
      'allow',
    ],
    ['null JSON', 'null', undefined, undefined],
    ['whitespace only', ' \r\n\t ', undefined, undefined],
  ];
}
