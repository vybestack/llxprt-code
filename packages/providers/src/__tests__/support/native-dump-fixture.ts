/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './journal-send-fixture.js';
import { normalizedRows } from './frozenWire/normalizedRows.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
  type WireRoute,
} from './wireBodyCapture.js';

const parent = join(import.meta.dir, '../../../../../tmp/dump-native');
const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'question 雪 🐈 \\"\n' }],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call_lookup',
        name: 'lookup',
        parameters: { path: '雪' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_lookup',
        toolName: 'lookup',
        result: { value: 'answer' },
      },
    ],
  },
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'finish' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'AQI=',
      },
    ],
  },
];

async function requestDump(root: string): Promise<string | undefined> {
  const files = await readdir(join(root, 'dumps')).catch(() => []);
  const name = files.find((file) => file.endsWith('-request.json'));
  if (name === undefined) return undefined;
  return (await readFile(join(root, 'dumps', name), 'utf8')).replace(
    /"timestamp": "[^"]+"/,
    '"timestamp": "<timestamp>"',
  );
}

async function send(
  route: WireRoute,
  selection: ProviderRequestSelection,
  mode: string,
): Promise<unknown> {
  const options = buildHistoryCallOptions(
    route,
    {
      id: 'native-dump',
      description: 'native dump',
      rows: [],
      systemInstruction: 'Answer precisely 雪.',
      tools: [
        {
          name: 'lookup',
          description: 'Look up a path',
          parametersJsonSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              password: { type: 'string', description: 'omit-me' },
              nested: {
                type: 'object',
                properties: {
                  token: { type: 'string', description: 'omit-too' },
                },
              },
            },
          },
        },
      ],
      ephemerals: {
        dumpcontext: mode,
        'responses-stateful': false,
        retries: 0,
      },
    },
    'rows',
    new SettingsService(),
    selection,
  );
  try {
    for await (const chunk of route.createProvider().generateChatCompletion({
      ...options,
      metadata: { _retryRequestContext: { reasoningIdTime: 1780000000123 } },
    }))
      void chunk;
    return undefined;
  } catch (error) {
    return error;
  }
}

async function observedCreates(
  action: () => Promise<void>,
): Promise<{ files: string[]; directories: string[] }> {
  const opened = spyOn(fs, 'open');
  const written = spyOn(fs, 'writeFile');
  const directories = spyOn(fs, 'mkdir');
  try {
    const observed = await operationFileCreates(action);
    return {
      files: [
        ...observed.files,
        ...opened.mock.calls
          .filter(
            ([, flags]) => typeof flags === 'string' && /[wa]/.test(flags),
          )
          .map(([path]) => String(path)),
        ...written.mock.calls.map(([path]) => String(path)),
      ],
      directories: [
        ...observed.directories,
        ...directories.mock.calls.map(([path]) => String(path)),
      ],
    };
  } finally {
    opened.mockRestore();
    written.mockRestore();
    directories.mockRestore();
  }
}

async function assertArtifacts(
  cache: string,
  expected: string | undefined,
  created: { files: string[]; directories: string[] },
  shouldDump: boolean,
  artifacts: number,
): Promise<void> {
  expect(await requestDump(cache)).toBe(expected);
  if (shouldDump) {
    expect(expected).toBeDefined();
    expect(expected).not.toContain('omit-me');
    expect(expected).not.toContain('AQI=');
    expect(expected).not.toContain('test-api-key');
    expect(expected).toContain('[REDACTED]');
    expect(new Set(created.files).size).toBe(artifacts);
    expect(await readdir(join(cache, 'dumps'))).toHaveLength(artifacts);
    for (const file of created.files) {
      expect(file.startsWith(join(cache, 'dumps/'))).toBe(true);
      expect(file).toMatch(/-(request|response)\.json$/);
    }
  } else expect(created.files).toEqual([]);
  for (const directory of created.directories)
    expect(directory).toBe(join(cache, 'dumps'));
}

function measuredSelection(source: ProviderRequestSelection): {
  selection: ProviderRequestSelection;
  reads(): number;
  reset(): void;
} {
  let reads = 0;
  return {
    reads: () => reads,
    reset: () => {
      reads = 0;
    },
    selection: {
      count: source.count,
      native: source.native,
      close: () => undefined,
      readAt(index, signal) {
        reads++;
        return source.readAt(index, signal);
      },
      async *openReader(signal) {
        for await (const row of source.openReader(signal)) {
          reads++;
          yield row;
        }
      },
    },
  };
}

export async function nativeDumpBehavior(
  routeId: string,
  mode: string,
  fail: boolean,
): Promise<void> {
  const found = WIRE_ROUTES.find((route) => route.id === routeId);
  if (found === undefined) throw new Error('Missing dump route');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  const bodies: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      bodies.push(await request.text());
      return fail
        ? Response.json(
            {
              error: { type: 'invalid_request_error', message: 'bad request' },
            },
            { status: 400 },
          )
        : found.respond();
    },
  });
  const route = {
    ...found,
    providerSettings: routeId.includes('responses')
      ? { ...found.providerSettings, apiMode: 'responses' }
      : found.providerSettings,
    baseURL: `http://127.0.0.1:${server.port}${routeId.startsWith('anthropic') ? '' : '/v1'}`,
  };
  const fixture = await journalSendFixture(rows, [], { directory: parent });
  const measured = measuredSelection(fixture.selection);
  let cache = join(root, 'baseline');
  const storage = spyOn(Storage, 'getGlobalCacheDir').mockImplementation(
    () => cache,
  );
  try {
    expect((await send(route, measured.selection, 'off')) !== undefined).toBe(
      fail,
    );
    const baselineReads = measured.reads();
    measured.reset();
    cache = join(root, 'legacy');
    expect(
      (await send(route, rowsSelection(await normalizedRows(rows)), mode)) !==
        undefined,
    ).toBe(fail);
    const expected = await requestDump(cache);
    cache = join(root, 'native');
    let error: unknown;
    const created = await observedCreates(async () => {
      error = await send(route, measured.selection, mode);
    });
    expect(error !== undefined).toBe(fail);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[1]);
    if (mode === 'on' || !fail) expect(measured.reads()).toBe(baselineReads);
    expect(bodies[2]).toContain(
      routeId.includes('responses') ? '"input":' : '"messages":',
    );
    await assertArtifacts(
      cache,
      expected,
      created,
      mode === 'on' || fail,
      routeId.includes('responses') && !fail ? 1 : 2,
    );
  } finally {
    storage.mockRestore();
    await fixture.close();
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}
