/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import * as dumpSDKContextModule from './dumpSDKContext.js';
import {
  dumpSDKContext,
  wrapStreamWithDump,
  wrapStreamWithSDKErrorDump,
} from './dumpSDKContext.js';

describe('dumpSDKContext', () => {
  const dumpDir = path.join(os.homedir(), '.llxprt', 'dumps');
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
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
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

    await expect(async () => {
      for await (const chunk of wrapped) {
        received.push(chunk);
      }
    }).rejects.toThrow('stream failed');

    expect(received).toStrictEqual([firstChunk]);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
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
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
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
    );
    const received: unknown[] = [];

    await expect(async () => {
      for await (const chunk of wrapped) {
        received.push(chunk);
      }
    }).rejects.toThrow('stream failed');

    expect(received).toStrictEqual([firstChunk]);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledExactlyOnceWith(
      'openai',
      '/chat/completions',
      requestBody,
      'https://api.openai.com/v1',
    );
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
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
});
