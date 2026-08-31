/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { Storage } from '@vybestack/llxprt-code-storage';
import * as dumpSDKContextModule from './dumpSDKContext.js';
import {
  dumpSDKContext,
  dumpSDKErrorRequestResponse,
  dumpSDKRequestContext,
  wrapStreamWithDump,
  wrapStreamWithSDKErrorDump,
} from './dumpSDKContext.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parse a written request dump file without type assertions (RULES.md). */
function parseDumpedRequest(content: string): {
  url: unknown;
  method: unknown;
  transport: unknown;
  headers: unknown;
} {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed) || !isRecord(parsed.request)) {
    throw new Error('dump envelope missing request object');
  }
  return {
    url: parsed.request.url,
    method: parsed.request.method,
    transport: parsed.request.transport,
    headers: parsed.request.headers,
  };
}

describe('dumpSDKContext metadata @issue:3159', () => {
  const dumpDir = path.join(Storage.getGlobalCacheDir(), 'dumps');
  const createdFiles: string[] = [];

  afterEach(async () => {
    // Restore mocks first so a cleanup failure cannot leave spies installed
    // for the next test; dump file removal stays best-effort.
    vi.restoreAllMocks();
    for (const file of createdFiles.splice(0)) {
      try {
        await fs.rm(path.join(dumpDir, file), { force: true });
      } catch {
        // A leftover dump file must not fail the test run.
      }
    }
  });

  it('records real headers with credential values redacted and WebSocket transport', async () => {
    const result = await dumpSDKRequestContext(
      'openai',
      '/responses',
      { model: 'gpt-5', input: [] },
      'wss://chatgpt.com/backend-api/codex',
      {
        headers: {
          Authorization: 'Bearer sk-secret',
          'ChatGPT-Account-ID': 'acct-secret',
          'OpenAI-Beta': 'responses_websockets=2026-02-06',
          session_id: 'session-123',
          'X-Debug': 'yes',
        },
        transport: { type: 'websocket', frameType: 'response.create' },
      },
    );
    createdFiles.push(result.requestFilename);

    const content = await fs.readFile(
      path.join(result.dumpDir, result.requestFilename),
      'utf-8',
    );
    const dump = parseDumpedRequest(content);

    expect(dump.url).toBe('wss://chatgpt.com/backend-api/codex/responses');
    expect(dump.method).toBe('SEND');
    expect(dump.transport).toStrictEqual({
      type: 'websocket',
      frameType: 'response.create',
    });
    expect(dump.headers).toStrictEqual({
      Authorization: '[REDACTED]',
      'ChatGPT-Account-ID': '[REDACTED]',
      'OpenAI-Beta': 'responses_websockets=2026-02-06',
      session_id: 'session-123',
      'X-Debug': 'yes',
    });
  });

  it('uses synthesized defaults and no transport when metadata omitted', async () => {
    const result = await dumpSDKRequestContext(
      'openai',
      '/responses',
      { model: 'gpt-5', input: [] },
      'https://api.openai.com/v1',
    );
    createdFiles.push(result.requestFilename);

    const content = await fs.readFile(
      path.join(result.dumpDir, result.requestFilename),
      'utf-8',
    );
    const dump = parseDumpedRequest(content);

    expect(dump.method).toBe('POST');
    expect(dump.transport).toBeUndefined();
    expect(dump.headers).toStrictEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'llxprt-code',
    });
  });

  it('threads metadata through dumpSDKContext to the written request file', async () => {
    const baseId = await dumpSDKContext(
      'openai',
      '/responses',
      { model: 'x' },
      { id: 'r' },
      false,
      'https://api.openai.com/v1',
      {
        headers: { Authorization: 'Bearer secret', 'X-Debug': '1' },
        transport: { type: 'http' },
      },
    );
    createdFiles.push(`${baseId}-request.json`, `${baseId}-response.json`);

    const content = await fs.readFile(
      path.join(dumpDir, `${baseId}-request.json`),
      'utf-8',
    );
    const dump = parseDumpedRequest(content);

    expect(dump.headers).toStrictEqual({
      Authorization: '[REDACTED]',
      'X-Debug': '1',
    });
    expect(dump.transport).toStrictEqual({ type: 'http' });
  });

  it('forwards metadata to the real request dumper via dumpSDKErrorRequestResponse', async () => {
    // Distinctive provider token: filenames embed it, so the created-file
    // diff below stays deterministic even if other dumps land in the shared
    // global cache dir while this test runs.
    const provider = 'dumpsdk3159';
    const before = await fs.readdir(dumpDir).catch(() => [] as string[]);

    await dumpSDKErrorRequestResponse(
      provider,
      '/chat/completions',
      { model: 'x' },
      { error: 'boom' },
      'https://api.openai.com/v1',
      undefined,
      undefined,
      {
        headers: { Authorization: 'Bearer secret', 'X-Debug': '1' },
        transport: { type: 'http' },
      },
    );

    const created = (await fs.readdir(dumpDir)).filter(
      (file) => !before.includes(file) && file.includes(`-${provider}-`),
    );
    createdFiles.push(...created);
    expect(created).toHaveLength(2);

    const requestName = created.find((file) => file.endsWith('-request.json'));
    const responseName = created.find((file) =>
      file.endsWith('-response.json'),
    );
    if (requestName === undefined || responseName === undefined) {
      throw new Error('expected both request and error-response dumps');
    }
    expect(responseName).toBe(
      requestName.replace('-request.json', '-response.json'),
    );

    const dump = parseDumpedRequest(
      await fs.readFile(path.join(dumpDir, requestName), 'utf-8'),
    );
    expect(dump.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(dump.method).toBe('POST');
    expect(dump.transport).toStrictEqual({ type: 'http' });
    expect(dump.headers).toStrictEqual({
      Authorization: '[REDACTED]',
      'X-Debug': '1',
    });

    const responseContent = await fs.readFile(
      path.join(dumpDir, responseName),
      'utf-8',
    );
    expect(responseContent).toContain('boom');
  });

  it('writes the metadata-bearing request dump when a wrapped stream fails mid-iteration', async () => {
    // Distinctive provider token keeps the created-file diff deterministic
    // (see the dumpSDKErrorRequestResponse test above).
    const provider = 'dumpsdk3159';
    const before = await fs.readdir(dumpDir).catch(() => [] as string[]);
    const stream = (async function* () {
      yield { text: 'partial' };
      throw new Error('stream failed');
    })();

    const wrapped = wrapStreamWithSDKErrorDump(
      stream,
      provider,
      '/chat/completions',
      { model: 'x' },
      'https://api.openai.com/v1',
      undefined,
      undefined,
      {
        headers: { Authorization: 'Bearer secret' },
        transport: { type: 'http' },
      },
    );

    await expect(
      (async () => {
        for await (const _chunk of wrapped) {
          void _chunk;
        }
      })(),
    ).rejects.toThrow('stream failed');

    const created = (await fs.readdir(dumpDir)).filter(
      (file) => !before.includes(file) && file.includes(`-${provider}-`),
    );
    createdFiles.push(...created);
    expect(created).toHaveLength(2);

    const requestName = created.find((file) => file.endsWith('-request.json'));
    assertDefined(requestName, 'expected the failure request dump');
    const dump = parseDumpedRequest(
      await fs.readFile(path.join(dumpDir, requestName), 'utf-8'),
    );
    expect(dump.headers).toStrictEqual({ Authorization: '[REDACTED]' });
    expect(dump.transport).toStrictEqual({ type: 'http' });
  });
});

describe('dumpSDKContext', () => {
  const dumpDir = path.join(Storage.getGlobalCacheDir(), 'dumps');
  const createdFiles: string[] = [];

  afterEach(async () => {
    for (const file of createdFiles.splice(0)) {
      await fs.rm(path.join(dumpDir, file), { force: true });
    }
  });

  it('should return a dump base id rather than a dump filename', async () => {
    const baseId = await dumpSDKContext(
      'openai',
      '/chat/completions',
      { model: 'test-model', messages: [] },
      { id: 'response-id' },
      false,
    );
    createdFiles.push(`${baseId}-request.json`, `${baseId}-response.json`);

    expect(baseId).not.toMatch(/\.json$/);
    const parts = baseId.split('-');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toHaveLength(8);
    expect(parts[1]).toHaveLength(6);
    expect(parts[2]).toBe('openai');
    expect(parts[3]).toBeTruthy();
  });

  it('should build dump URLs like the OpenAI SDK when the base URL has a trailing slash', async () => {
    const result = await dumpSDKRequestContext(
      'openai',
      '/chat/completions',
      { model: 'test-model', messages: [] },
      'https://ollama.com/v1/',
    );
    createdFiles.push(result.requestFilename);

    const content = await fs.readFile(
      path.join(result.dumpDir, result.requestFilename),
      'utf-8',
    );
    const dump = parseDumpedRequest(content);

    expect(dump.url).toBe('https://ollama.com/v1/chat/completions');
  });

  it('should redact a lowercase authorization header value at write time', async () => {
    const result = await dumpSDKRequestContext(
      'openai',
      '/chat/completions',
      { model: 'test-model', messages: [] },
      'https://api.openai.com/v1',
      { headers: { authorization: 'Bearer sk-abc' } },
    );
    createdFiles.push(result.requestFilename);
    const content = await fs.readFile(
      path.join(result.dumpDir, result.requestFilename),
      'utf-8',
    );
    expect(content).toContain('authorization');
    expect(content).toContain('[REDACTED]');
    expect(content).not.toContain('sk-abc');
  });
});

describe('dumpSDKErrorRequestResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write an error response dump even when request dumping fails', async () => {
    const dumpSDKRequestContextSpy = vi
      .spyOn(dumpSDKContextModule, 'dumpSDKRequestContext')
      .mockRejectedValue(new Error('disk full'));
    const dumpSDKResponseContextSpy = vi
      .spyOn(dumpSDKContextModule, 'dumpSDKResponseContext')
      .mockResolvedValue('fallback-response.json');
    const requestBody = { model: 'test-model', messages: [] };

    await dumpSDKContextModule.dumpSDKErrorRequestResponse(
      'openai',
      '/chat/completions',
      requestBody,
      { error: 'Rate limit' },
      'https://api.openai.com/v1',
      dumpSDKRequestContextSpy,
      dumpSDKResponseContextSpy,
      undefined,
    );

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      undefined,
      'openai',
      { error: 'Rate limit' },
      true,
    );
  });
});

describe('wrapStreamWithDump', () => {
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue('base-response.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass chunks through unchanged and dump accumulated chunks on success', async () => {
    const chunks = [{ text: 'hello' }, { text: ' world' }];
    const stream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();

    const wrapped = wrapStreamWithDump(
      stream,
      'base-123',
      'openai',
      dumpSDKResponseContextSpy,
    );
    const received: unknown[] = [];

    for await (const chunk of wrapped) {
      received.push(chunk);
    }

    expect(received).toStrictEqual(chunks);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      'base-123',
      'openai',
      { streaming: true, chunks, completed: true },
      false,
    );
  });

  it('should dump accumulated chunks as an error response and rethrow stream errors exactly once', async () => {
    const firstChunk = { text: 'partial' };
    const stream = (async function* () {
      yield firstChunk;
      throw new Error('stream failed');
    })();

    const wrapped = wrapStreamWithDump(
      stream,
      'base-456',
      'anthropic',
      dumpSDKResponseContextSpy,
    );
    const received: unknown[] = [];

    await expect(
      (async () => {
        for await (const chunk of wrapped) {
          received.push(chunk);
        }
      })(),
    ).rejects.toThrow('stream failed');

    expect(received).toStrictEqual([firstChunk]);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      'base-456',
      'anthropic',
      {
        streaming: true,
        chunks: [firstChunk],
        error: 'Error: stream failed',
        completed: false,
      },
      true,
    );
  });

  it('should dump accumulated chunks when the consumer stops iterating early', async () => {
    const chunks = [{ text: 'first' }, { text: 'second' }];
    const stream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();

    const wrapped = wrapStreamWithDump(
      stream,
      'base-cancelled',
      'gemini',
      dumpSDKResponseContextSpy,
    );
    const received: unknown[] = [];

    for await (const chunk of wrapped) {
      received.push(chunk);
      break;
    }

    expect(received).toStrictEqual([chunks[0]]);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      'base-cancelled',
      'gemini',
      { streaming: true, chunks: [chunks[0]], completed: false },
      false,
    );
  });

  it('should dump related request and error response and rethrow stream errors without a request base id', async () => {
    const firstChunk = { text: 'partial' };
    const requestBody = { model: 'test-model', messages: [] };
    const stream = (async function* () {
      yield firstChunk;
      throw new Error('stream failed');
    })();
    const dumpSDKRequestContextSpy = vi
      .spyOn(dumpSDKContextModule, 'dumpSDKRequestContext')
      .mockResolvedValue({
        baseId: 'base-789',
        requestFilename: 'base-789-request.json',
        dumpDir: '/tmp',
      });

    const wrapped = wrapStreamWithSDKErrorDump(
      stream,
      'openai',
      '/chat/completions',
      requestBody,
      'https://api.openai.com/v1',
      dumpSDKRequestContextSpy,
      dumpSDKResponseContextSpy,
      undefined,
    );
    const received: unknown[] = [];

    await expect(
      (async () => {
        for await (const chunk of wrapped) {
          received.push(chunk);
        }
      })(),
    ).rejects.toThrow('stream failed');

    expect(received).toStrictEqual([firstChunk]);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledWith(
      'openai',
      '/chat/completions',
      requestBody,
      'https://api.openai.com/v1',
      undefined,
    );
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      'base-789',
      'openai',
      {
        streaming: true,
        chunks: [firstChunk],
        error: 'Error: stream failed',
        completed: false,
      },
      true,
    );
  });

  it('should write an error response dump even when request dumping fails', async () => {
    const dumpSDKRequestContextSpy = vi
      .spyOn(dumpSDKContextModule, 'dumpSDKRequestContext')
      .mockRejectedValue(new Error('disk full'));
    const dumpSDKResponseContextSpy = vi
      .spyOn(dumpSDKContextModule, 'dumpSDKResponseContext')
      .mockResolvedValue('fallback-response.json');
    const requestBody = { model: 'test-model', messages: [] };
    const stream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            throw new Error('stream failed');
          },
        };
      },
    };

    const wrapped = wrapStreamWithSDKErrorDump(
      stream,
      'openai',
      '/chat/completions',
      requestBody,
      'https://api.openai.com/v1',
      dumpSDKRequestContextSpy,
      dumpSDKResponseContextSpy,
    );

    await expect(
      (async () => {
        for await (const _chunk of wrapped) {
          // Exhaust stream.
        }
      })(),
    ).rejects.toThrow('stream failed');

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      undefined,
      'openai',
      {
        streaming: true,
        chunks: [],
        error: 'Error: stream failed',
        completed: false,
      },
      true,
    );
  });
});
