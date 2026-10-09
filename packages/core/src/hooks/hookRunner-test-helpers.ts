/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi, describe, it, expect } from 'bun:test';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { Config } from '../config/config.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import type { HookRunner } from './hookRunner.js';
import { join } from 'node:path';
import {
  HookEventName,
  HookType,
  type HookInput,
  type HookConfig,
  type HookOutput,
} from './types.js';
import { escapeShellArg, getShellConfiguration } from '../utils/shell-utils.js';
import type { IContent } from '../services/history/IContent.js';
import { ProviderNormalizationDisk } from '../services/history/provider-normalization-disk.js';
import {
  NormalizedProviderRequestSnapshot,
  providerRequestRows,
} from '../services/history/provider-request-snapshot.js';
import type { NormalizedProviderRequestSnapshot as RequestSnapshot } from '../services/history/provider-request-snapshot.js';
import { RowOwnership } from '../recording/rowOwnership.js';
import type { RowOwnership as RowOwners } from '../recording/rowOwnership.js';
import type { HookModelRowsInput } from './hookModelInputStream.js';
export const large: IContent = {
  speaker: 'human',
  blocks: [
    {
      type: 'text',
      text: '\u{1f600}雪'.repeat(1024 * 1024) + 'x'.repeat(3 * 1024 * 1024),
    },
  ],
};

export const rich: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: '😀 café 漢字 "quoted"\n\u0000 \ud800' },
    {
      type: 'tool_call',
      id: 'call',
      name: 'search',
      parameters: { query: '猫', absent: undefined },
      providerMetadata: { nested: [null, false] },
    },
    {
      type: 'tool_response',
      callId: 'call',
      toolName: 'search',
      result: { answer: 'résultat' },
      isComplete: true,
    },
    {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'base64',
      data: 'YWJj',
      dimensions: { width: 2, height: 3 },
      semanticMetadata: { caption: '雪' },
    },
    {
      type: 'thinking',
      thought: '理由',
      signature: 'signed',
      encryptedContent: 'ZW5j',
      sourceField: 'reasoning_content',
      providerMetadata: { provider: 'opaque' },
    },
  ],
  metadata: {
    id: 'rich',
    provider: 'test',
    providerMetadata: { opaque: { unicode: '🌍' } },
  },
};

export function command(script: string): HookConfig {
  const shell = getShellConfiguration().shell;
  return {
    type: HookType.Command,
    command: `exec ${escapeShellArg('node', shell)} -e ${escapeShellArg(script, shell)}`,
    timeout: 10000,
  };
}

export async function fixture(
  rows: readonly IContent[],
  action: (
    snapshot: RequestSnapshot,
    owners: RowOwners,
    root: string,
  ) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(process.cwd(), 'tmp/hook-source-'));
  const disk = new ProviderNormalizationDisk(root);
  const owners = new RowOwnership();
  for (const row of rows) disk.append('ordered', row);
  const snapshot = new NormalizedProviderRequestSnapshot(
    disk,
    0,
    undefined,
    owners,
  );
  try {
    await action(snapshot, owners, root);
  } finally {
    snapshot.close();
  }
}

export function input(
  mockInput: HookInput,
  snapshot: RequestSnapshot,
  root: string,
  event: HookEventName.BeforeModel | HookEventName.AfterModel,
): HookModelRowsInput {
  const base = {
    ...mockInput,
    cwd: root,
    llm_request: {
      version: 2,
      model: 'model-雪',
      contents: providerRequestRows(snapshot),
      tools: [],
      settings: { temperature: 0 },
    },
  } satisfies Omit<HookModelRowsInput, 'hook_event_name'>;
  return event === HookEventName.AfterModel
    ? {
        ...base,
        hook_event_name: event,
        llm_response: { version: 2, content: rich, finishReason: 'stop' },
      }
    : { ...base, hook_event_name: event };
}

const malformed = '{ "decision": "allow", incomplete';
const plain = 'not json at all';
const warning = '{ broken json';
const blocking = '{ "error": incomplete';
const decoded: HookOutput = { decision: 'allow', reason: 'All good' };
export const invalidJsonCases: Array<
  [string, number, string, HookOutput | undefined]
> = [
  [
    'should handle invalid JSON output gracefully',
    0,
    malformed,
    { decision: 'allow', systemMessage: malformed },
  ],
  [
    'should handle malformed JSON with exit code 0',
    0,
    plain,
    { decision: 'allow', systemMessage: plain },
  ],
  [
    'should handle invalid JSON with exit code 1 (non-blocking error)',
    1,
    warning,
    { decision: 'allow', systemMessage: 'Warning: ' + warning },
  ],
  [
    'should handle invalid JSON with exit code 2 (blocking error)',
    2,
    blocking,
    { decision: 'deny', reason: blocking },
  ],
  ['should handle empty JSON output', 0, '', undefined],
  [
    'should handle double-encoded JSON string',
    0,
    JSON.stringify(JSON.stringify(decoded)),
    decoded,
  ],
];

// Mock type for the child_process spawn
export type MockChildProcessWithoutNullStreams =
  ChildProcessWithoutNullStreams & {
    mockStdinWrite: ReturnType<typeof vi.fn>;
    mockStdoutOn: ReturnType<typeof vi.fn>;
    mockStderrOn: ReturnType<typeof vi.fn>;
    mockProcessOn: ReturnType<typeof vi.fn>;
  };

export function createMockSpawn(): MockChildProcessWithoutNullStreams {
  // Mock spawn with accessible mock functions
  const mockStdinWrite = vi.fn();
  const mockStdoutOn = vi.fn();
  const mockStderrOn = vi.fn();
  const mockProcessOn = vi.fn();

  return {
    stdin: {
      write: mockStdinWrite,
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as Writable,
    stdout: {
      on: mockStdoutOn,
    } as unknown as Readable,
    stderr: {
      on: mockStderrOn,
    } as unknown as Readable,
    on: mockProcessOn,
    kill: vi.fn(),
    killed: false,
    mockStdinWrite,
    mockStdoutOn,
    mockStderrOn,
    mockProcessOn,
  } as unknown as MockChildProcessWithoutNullStreams;
}

// Mock Config object with required methods
export const mockConfig = {
  isTrustedFolder: () => true,
  getSanitizationConfig: () => ({
    enableEnvironmentVariableRedaction: false,
    allowedEnvironmentVariables: [],
    blockedEnvironmentVariables: [],
  }),
} as unknown as Config;

export const mockInput: HookInput = {
  session_id: 'test-session',
  transcript_path: '/path/to/transcript',
  cwd: '/test/project',
  hook_event_name: 'BeforeTool',
  timestamp: '2025-01-01T00:00:00.000Z',
};

export function registerInputParity(runner: () => HookRunner): void {
  describe('input parity', () => {
    for (const [event, rows] of [
      [HookEventName.BeforeModel, []],
      [
        HookEventName.BeforeModel,
        [rich, { speaker: 'human', blocks: [{ type: 'text', text: 'tail' }] }],
      ],
      [HookEventName.AfterModel, [rich]],
      [HookEventName.BeforeModel, [large]],
    ] satisfies Array<
      [HookEventName.BeforeModel | HookEventName.AfterModel, IContent[]]
    >) {
      it(`decodes exact v2 ${event} JSON for ${rows.length} rows (${Buffer.byteLength(JSON.stringify(rows))} fixture bytes)`, async () => {
        await fixture(rows, async (snapshot, owners, root) => {
          const source = input(mockInput, snapshot, root, event);
          writeFileSync(
            join(root, 'oracle.json'),
            JSON.stringify({
              ...source,
              llm_request: { ...source.llm_request, contents: rows },
            }),
          );
          const receipt = command(`
            const fs = require('node:fs'), {isDeepStrictEqual} = require('node:util');
            (async () => {
              await new Promise(r => process.stdout.write(' '.repeat(1024*1024), r));
              await new Promise(r => process.stderr.write('d'.repeat(1024*1024), r));
              process.stdin.setEncoding('utf8');
              let body = ''; for await (const chunk of process.stdin) body += chunk;
              const decoded = JSON.parse(body), expected = JSON.parse(fs.readFileSync('oracle.json', 'utf8'));
              process.stdout.write(JSON.stringify({decision:'allow', systemMessage: JSON.stringify({equal:isDeepStrictEqual(decoded,expected),count:decoded.llm_request.contents.length,cwd:process.cwd(),env:process.env.LLXPRT_PROJECT_DIR})}));
            })();
          `);
          const result = await runner().executeHookWithRequestRows(
            receipt,
            event,
            source,
          );
          expect(result.error).toBeUndefined();
          expect(result.success).toBe(true);
          expect(
            JSON.parse(
              String(result.output?.readValue(['systemMessage']) ?? 'null'),
            ),
          ).toStrictEqual({
            equal: true,
            count: rows.length,
            cwd: root,
            env: root,
          });
          expect(result.stderr.readText()).toBe('d'.repeat(1024 * 1024));
          result.dispose();
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.snapshot().peakRows).toBe(rows.length === 0 ? 0 : 1);
        });
      });
    }
  });
}

export function registerInputFailures(runner: () => HookRunner): void {
  describe('input failures', () => {
    for (const [mode, message, output] of [
      ['epipe', /EPIPE|stdin completed/, undefined],
      ['timeout', /timed out/, undefined],
      [
        'blocking',
        /EPIPE|stdin completed/,
        { decision: 'deny', reason: 'blocked before reading' },
      ],
    ] satisfies Array<
      ['epipe' | 'timeout' | 'blocking', RegExp, HookOutput | undefined]
    >) {
      it(`releases disk input and stops the real command on ${mode}`, async () => {
        await fixture([large, rich], async (snapshot, owners, root) => {
          const action = {
            epipe: 'process.exit(0);',
            timeout: 'process.stdin.pause();',
            blocking:
              'process.stderr.write("blocked before reading"); process.exit(2);',
          }[mode];
          const hook = command(
            `const fs=require('node:fs'); fs.writeFileSync('pid', String(process.pid)); ${action} setInterval(() => {}, 1000);`,
          );
          const result = await runner().executeHookWithRequestRows(
            { ...hook, timeout: mode === 'timeout' ? 100 : hook.timeout },
            HookEventName.BeforeModel,
            input(mockInput, snapshot, root, HookEventName.BeforeModel),
          );
          expect(result.success).toBe(false);
          expect(result.error?.message).toMatch(message);
          if (output === undefined) expect(result.output).toBeUndefined();
          else
            for (const [key, value] of Object.entries(output))
              expect(result.output?.readValue([key])).toStrictEqual(value);
          result.dispose();
          expect(owners.snapshot().liveRows).toBe(0);
          const pid = Number(readFileSync(join(root, 'pid'), 'utf8'));
          expect(() => process.kill(pid, 0)).toThrow('ESRCH');
        });
      });
    }
  });
}

export async function cancelsBlockedInput(
  runner: () => HookRunner,
): Promise<void> {
  await fixture(
    [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'x'.repeat(10 * 1024 * 1024) }],
      },
      rich,
    ],
    async (snapshot, owners, root) => {
      const controller = new AbortController();
      const reason = new Error('cancel blocked hook input');
      const hook = command(
        `require('node:fs').writeFileSync('ready', String(process.pid)); process.stdin.pause(); setInterval(() => {}, 1000);`,
      );
      const pending = runner().executeHookWithRequestRows(
        { ...hook, command: `${hook.command} & wait` },
        HookEventName.BeforeModel,
        input(mockInput, snapshot, root, HookEventName.BeforeModel),
        controller.signal,
      );
      while (
        !existsSync(join(root, 'ready')) ||
        owners.snapshot().liveRows !== 1
      )
        await new Promise((resolve) => setTimeout(resolve, 5));
      const pid = Number(readFileSync(join(root, 'ready'), 'utf8'));
      controller.abort(reason);
      const result = await pending;
      expect(result.success).toBe(false);
      expect(result.error).toBe(reason);
      result.dispose();
      expect(owners.snapshot().liveRows).toBe(0);
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');
      const reader = snapshot.openReader();
      expect((await reader.next()).done).toBe(false);
      expect(owners.snapshot().liveRows).toBe(1);
      const returned = await reader.return();
      expect({ returned, liveRows: owners.snapshot().liveRows }).toStrictEqual({
        returned: { done: true, value: undefined },
        liveRows: 0,
      });
    },
  );
}

export function registerCancellationInputTest(runner: () => HookRunner): void {
  describe('input cancellation', () => {
    it('cancels while a real child leaves stdin blocked and releases the cursor', () =>
      cancelsBlockedInput(runner));
  });
}
