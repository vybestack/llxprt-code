/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runScriptedPrompt,
  stopReply,
  turnRecords,
} from './helpers/refusal-endpoint.js';

setDefaultTimeout(90_000);

let cacheRoot = '';
let previousCacheRoot: string | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected dump JSON object');
  }
  return Object.fromEntries(Object.entries(value));
}

function readDump(directory: string, name: string): Record<string, unknown> {
  const contents: unknown = JSON.parse(
    readFileSync(join(directory, name), 'utf8'),
  );
  return asRecord(contents);
}

describe('refusal dump pairing (issue #4101)', () => {
  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'llxprt-4101-dumps-'));
    previousCacheRoot = process.env['LLXPRT_CACHE_HOME'];
    process.env['LLXPRT_CACHE_HOME'] = cacheRoot;
  });

  afterEach(() => {
    if (previousCacheRoot === undefined)
      delete process.env['LLXPRT_CACHE_HOME'];
    else process.env['LLXPRT_CACHE_HOME'] = previousCacheRoot;
    rmSync(cacheRoot, { recursive: true, force: true });
  });
  it('writes the refusal and first accepted pair with attempt evidence', async () => {
    const run = await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          text: 'partial refused output',
          outputTokens: 6,
          stopDetails: {
            type: 'policy',
            category: 'safety',
            explanation: 'restricted content',
          },
        },
        stopReply('accepted answer'),
      ],
      ['same prompt'],
      {
        protocol: 'anthropic',
        settings: {
          dumpcontext: 'error',
          'refusal.retries': 1,
          'refusal.backoff-ms': 1,
        },
      },
    );

    const dumpDir = join(cacheRoot, 'dumps');
    const files = existsSync(dumpDir) ? readdirSync(dumpDir).sort() : [];
    expect(files).toHaveLength(4);
    const requestFiles = files.filter((name) => name.endsWith('-request.json'));
    const responseFiles = files.filter((name) =>
      name.endsWith('-response.json'),
    );
    expect(requestFiles).toHaveLength(2);
    expect(responseFiles).toHaveLength(2);

    const requests = requestFiles.map((name) => readDump(dumpDir, name));
    const responses = responseFiles.map((name) => readDump(dumpDir, name));
    expect(requests.map((dump) => dump['outcome']).sort()).toStrictEqual([
      'paired-success',
      'refusal',
    ]);
    expect(responses.map((dump) => dump['outcome']).sort()).toStrictEqual([
      'paired-success',
      'refusal',
    ]);
    for (const dump of [...requests, ...responses]) {
      expect(dump['promptId']).toBeString();
      expect(dump['attemptIndex']).toBeNumber();
    }
    const refusalResponse = responses.find(
      (dump) => dump['outcome'] === 'refusal',
    );
    expect(JSON.stringify(refusalResponse)).toContain('message_delta');
    expect(JSON.stringify(refusalResponse)).toContain('stop_details');
    expect(JSON.stringify(refusalResponse)).toContain('partial refused output');

    const refusals = run.journalRecords.filter(
      (record) => record['type'] === 'refusal',
    );
    const refusalPayload = asRecord(refusals[0]?.['payload']);
    const turns = turnRecords(run.tokenRecords);
    expect(refusalPayload['dump_base_id']).toBeString();
    expect(turns.map((record) => record['dump_base_id'])).toContain(
      refusalPayload['dump_base_id'],
    );
  });

  it('captures OpenAI Chat refusal and the paired accepted completion', async () => {
    await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          text: 'refused answer',
          outputTokens: 4,
        },
        stopReply('accepted answer'),
      ],
      ['same prompt'],
      {
        settings: {
          dumpcontext: 'error',
          'refusal.retries': 1,
          'refusal.backoff-ms': 1,
        },
      },
    );

    const dumpDir = join(cacheRoot, 'dumps');
    const files = readdirSync(dumpDir).sort();
    expect(files).toHaveLength(4);
    const responses = files
      .filter((name) => name.endsWith('-response.json'))
      .map((name) => readDump(dumpDir, name));
    expect(responses.map((dump) => dump['outcome']).sort()).toStrictEqual([
      'paired-success',
      'refusal',
    ]);
    expect(JSON.stringify(responses)).toContain('refused answer');
    for (const dump of responses) {
      expect(dump['promptId']).toBeString();
      expect(dump['attemptIndex']).toBeNumber();
    }
  });

  it('captures Anthropic JSON refusal and its paired accepted completion', async () => {
    await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          text: 'anthropic json refusal',
          outputTokens: 4,
        },
        stopReply('accepted answer'),
      ],
      ['same prompt'],
      {
        protocol: 'anthropic',
        settings: {
          dumpcontext: 'error',
          streaming: 'disabled',
          'refusal.retries': 1,
          'refusal.backoff-ms': 1,
        },
      },
    );

    const dumpDir = join(cacheRoot, 'dumps');
    const files = readdirSync(dumpDir).sort();
    expect(files).toHaveLength(4);
    const responses = files
      .filter((name) => name.endsWith('-response.json'))
      .map((name) => readDump(dumpDir, name));
    expect(responses.map((dump) => dump['outcome']).sort()).toStrictEqual([
      'paired-success',
      'refusal',
    ]);
    expect(JSON.stringify(responses)).toContain('anthropic json refusal');
  });

  it('captures OpenAI Chat JSON refusal and its paired accepted completion', async () => {
    await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          text: 'openai json refusal',
          outputTokens: 4,
        },
        stopReply('accepted answer'),
      ],
      ['same prompt'],
      {
        settings: {
          dumpcontext: 'error',
          streaming: 'disabled',
          'refusal.retries': 1,
          'refusal.backoff-ms': 1,
        },
      },
    );

    const dumpDir = join(cacheRoot, 'dumps');
    const files = readdirSync(dumpDir).sort();
    expect(files).toHaveLength(4);
    const responses = files
      .filter((name) => name.endsWith('-response.json'))
      .map((name) => readDump(dumpDir, name));
    expect(responses.map((dump) => dump['outcome']).sort()).toStrictEqual([
      'paired-success',
      'refusal',
    ]);
    expect(JSON.stringify(responses)).toContain('openai json refusal');
  });

  it('does not dump successful requests in error mode before a refusal', async () => {
    await runScriptedPrompt(
      [stopReply('ordinary answer')],
      ['ordinary prompt'],
      {
        protocol: 'anthropic',
        settings: { dumpcontext: 'error' },
      },
    );

    expect(readdirSync(cacheRoot)).toStrictEqual([]);
  });

  it('writes exactly one pair per attempt in on mode', async () => {
    await runScriptedPrompt(
      [stopReply('ordinary answer')],
      ['ordinary prompt'],
      { protocol: 'anthropic', settings: { dumpcontext: 'on' } },
    );

    const dumpDir = join(cacheRoot, 'dumps');
    const files = existsSync(dumpDir) ? readdirSync(dumpDir) : [];
    expect(files).toHaveLength(2);
    expect(files.filter((name) => name.endsWith('-request.json'))).toHaveLength(
      1,
    );
    expect(
      files.filter((name) => name.endsWith('-response.json')),
    ).toHaveLength(1);
  });
});
