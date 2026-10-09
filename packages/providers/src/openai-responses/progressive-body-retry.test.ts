/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heapSize } from 'bun:jsc';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';

function history(rows = 512, padding = 70_000) {
  let opened = 0;
  let pulled = 0;
  let closed = false;
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      opened += 1;
      try {
        for (let index = 0; index < rows; index += 1) {
          pulled += 1;
          yield {
            speaker: 'human',
            blocks: [{ type: 'text', text: `${index}:${'x'.repeat(padding)}` }],
          };
        }
      } finally {
        closed = true;
      }
    },
  };
  return { contents, state: () => ({ opened, pulled, closed }) };
}

function completed(): Response {
  return new Response(
    'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_retry","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function expectedBody(rows = 512, padding = 70_000): string {
  return JSON.stringify({
    model: 'o3-mini',
    input: Array.from({ length: rows }, (_, index) => ({
      role: 'user',
      content: `${index}:${'x'.repeat(padding)}`,
    })),
    stream: true,
    instructions: 'Read rows.',
  });
}

async function runRetry(
  partial: boolean,
  rows = 512,
  padding = 70_000,
): Promise<{ text: string; completeBodies: number }> {
  const source = history(rows, padding);
  const saved = globalThis.fetch;
  let attempts = 0;
  const bodies: string[] = [];
  const first: Uint8Array[] = [];
  globalThis.fetch = Object.assign(
    async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      attempts += 1;
      expect(activeRequestBodyCount()).toBe(1);
      if (!(init?.body instanceof ReadableStream))
        throw new Error('Expected upload stream');
      if (attempts === 1 && partial) {
        const reader = init.body.getReader();
        for (let pull = 0; pull < 4; pull += 1) {
          const next = await reader.read();
          if (next.done) throw new Error('Upload ended early');
          first.push(next.value);
        }
        expect(source.state()).toStrictEqual({
          opened: 1,
          pulled: 1,
          closed: false,
        });
        await reader.cancel();
        throw new Error('fetch failed');
      }
      bodies.push(await new Response(init.body).text());
      if (attempts === 1)
        return new Response('{"error":{"message":"retry"}}', { status: 503 });
      return completed();
    },
    { preconnect: saved.preconnect },
  );
  try {
    const options = streamCallOptions({
      providerName: 'openai-responses',
      contents: source.contents,
      settingsOverrides: {
        provider: { model: 'o3-mini', 'prompt-caching': 'off' },
      },
      ephemerals: { retries: 2, retrywait: 0 },
      systemInstruction: 'Read rows.',
    });
    const provider = new OpenAIResponsesProvider(
      'test-key',
      'https://body.invalid/v1',
    );
    const output: string[] = [];
    for await (const row of provider.generateChatCompletion(options)) {
      output.push(
        ...row.blocks.flatMap((block) =>
          block.type === 'text' ? [block.text] : [],
        ),
      );
    }
    expect(attempts).toBe(2);
    expect(source.state()).toStrictEqual({
      opened: 1,
      pulled: rows,
      closed: true,
    });
    expect(bodies.every((body) => body === expectedBody(rows, padding))).toBe(
      true,
    );
    if (partial)
      expect(bodies[0]?.startsWith(Buffer.concat(first).toString())).toBe(true);
    expect(activeRequestBodyCount()).toBe(0);
    return { text: output.join(''), completeBodies: bodies.length };
  } finally {
    globalThis.fetch = saved;
  }
}

function diskReplayHistory() {
  const references: Array<WeakRef<IContent>> = [];
  let pulled = 0;
  let closed = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      try {
        for (let index = 0; index < 512; index += 1) {
          if (index === 1) await gate;
          const row: IContent = {
            speaker: 'human',
            blocks: [{ type: 'text', text: `${index}:${'x'.repeat(70_000)}` }],
          };
          references.push(new WeakRef(row));
          pulled += 1;
          yield row;
        }
      } finally {
        closed = true;
      }
    },
  };
  return {
    contents,
    references,
    release: () => release(),
    state: () => ({ pulled, closed }),
  };
}

function retryEndpoint(
  source: ReturnType<typeof diskReplayHistory>,
  root: string,
  baselineHeap: number,
) {
  const digests: string[] = [];
  const liveCounts: number[] = [];
  const retainedBytes: number[] = [];
  const snapshotSizes: number[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      if (request.body === null) throw new Error('Missing HTTP upload');
      const reader = request.body.getReader();
      const hash = createHash('sha256');
      let prefix = '';
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        hash.update(next.value);
        if (digests.length === 0 && prefix.length < 100) {
          prefix += new TextDecoder().decode(next.value);
          if (prefix.includes('0:')) {
            await Bun.sleep(0);
            expect(source.state().pulled).toBe(1);
            source.release();
          }
        }
      }
      reader.releaseLock();
      digests.push(hash.digest('hex'));
      const snapshots = readdirSync(root);
      expect(snapshots).toHaveLength(1);
      snapshotSizes.push(statSync(join(root, snapshots[0], 'rows')).size);
      await Bun.sleep(0);
      Bun.gc(true);
      retainedBytes.push(heapSize() - baselineHeap);
      liveCounts.push(
        source.references.filter((reference) => reference.deref() !== undefined)
          .length,
      );
      return digests.length === 1
        ? new Response('{"error":{"message":"retry"}}', { status: 503 })
        : completed();
    },
  });
  return { server, digests, liveCounts, retainedBytes, snapshotSizes };
}

describe('progressive Responses upload retry', () => {
  it('replays an interrupted input part and emits the response once', async () => {
    expect(await runRetry(true)).toStrictEqual({
      text: 'finished',
      completeBodies: 1,
    });
  });
  it.each([
    [512, 70_000],
    [1, 10 * 1024 * 1024],
  ])(
    'replays completed BODY bytes for %s rows of %s bytes without reopening history',
    async (rows, padding) => {
      expect(await runRetry(false, rows, padding)).toStrictEqual({
        text: 'finished',
        completeBodies: 2,
      });
    },
  );
});

describe('bounded Responses text HTTP replay', () => {
  it('retries byte-identical text BODY from disk without retaining uploaded rows', async () => {
    const source = diskReplayHistory();
    const root = mkdtempSync(join(tmpdir(), 'responses-http-test-'));
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = root;
    await Bun.sleep(0);
    Bun.gc(true);
    const endpoint = retryEndpoint(source, root, heapSize());
    try {
      const options = streamCallOptions({
        providerName: 'openai-responses',
        contents: source.contents,
        settingsOverrides: {
          provider: { model: 'o3-mini', 'prompt-caching': 'off' },
        },
        ephemerals: { retries: 2, retrywait: 0 },
        systemInstruction: 'Read rows.',
      });
      const provider = new OpenAIResponsesProvider(
        'test-key',
        `http://127.0.0.1:${endpoint.server.port}/v1`,
      );
      const output: string[] = [];
      for await (const row of provider.generateChatCompletion(options)) {
        output.push(
          ...row.blocks.flatMap((block) =>
            block.type === 'text' ? [block.text] : [],
          ),
        );
      }
      const expected = createHash('sha256')
        .update(expectedBody())
        .digest('hex');
      expect(endpoint.digests).toStrictEqual([expected, expected]);
      expect(source.state()).toStrictEqual({ pulled: 512, closed: true });
      expect(output.join('')).toBe('finished');
      expect(activeRequestBodyCount()).toBe(0);
      for (const count of endpoint.liveCounts)
        expect(count).toBeLessThanOrEqual(2);
      for (const bytes of endpoint.retainedBytes)
        expect(bytes).toBeLessThan(1024 * 1024);
      expect(endpoint.snapshotSizes[0]).toBeGreaterThan(9 * 1024 * 1024);
      expect(endpoint.snapshotSizes[1]).toBe(endpoint.snapshotSizes[0]);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      source.release();
      await endpoint.server.stop(true);
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('bounded Responses text HTTP cancellation', () => {
  it('closes a cold source when the first-row HTTP upload is cancelled', async () => {
    const source = history();
    const controller = new AbortController();
    const saved = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ): Promise<Response> => {
        if (!(init?.body instanceof ReadableStream))
          throw new Error('Expected upload stream');
        const reader = init.body.getReader();
        for (let pull = 0; pull < 4; pull += 1) await reader.read();
        expect(source.state().pulled).toBe(1);
        controller.abort(new Error('cancel upload'));
        await reader.cancel();
        throw controller.signal.reason;
      },
      { preconnect: saved.preconnect },
    );
    try {
      const options = streamCallOptions({
        providerName: 'openai-responses',
        contents: source.contents,
        settingsOverrides: {
          provider: { model: 'o3-mini', 'prompt-caching': 'off' },
        },
        ephemerals: { retries: 2, retrywait: 0 },
        systemInstruction: 'Read rows.',
        metadata: { abortSignal: controller.signal },
      });
      const provider = new OpenAIResponsesProvider(
        'test-key',
        'https://body.invalid/v1',
      );
      const request = provider.generateChatCompletion(options);
      await expect(request.next()).rejects.toThrow('cancel upload');
      expect(source.state()).toStrictEqual({
        opened: 1,
        pulled: 1,
        closed: true,
      });
      expect(activeRequestBodyCount()).toBe(0);
    } finally {
      globalThis.fetch = saved;
    }
  });
});
