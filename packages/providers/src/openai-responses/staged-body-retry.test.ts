/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  median,
  settledHeap,
} from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  getScratchRoot,
  removeScratchRoot,
} from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';

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
  const scratchBefore = requestScratchEntries();
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
      if (!(init?.body instanceof ReadableStream))
        throw new Error('Expected upload stream');
      if (attempts === 1 && partial) {
        const reader = init.body.getReader();
        for (let pull = 0; pull < 4; pull += 1) {
          const next = await reader.read();
          if (next.done) throw new Error('Upload ended early');
          first.push(next.value);
        }
        // The whole history was staged before the first byte.
        expect(source.state()).toStrictEqual({
          opened: 1,
          pulled: rows,
          closed: true,
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
    expect(requestScratchEntries()).toStrictEqual(scratchBefore);
    return { text: output.join(''), completeBodies: bodies.length };
  } finally {
    globalThis.fetch = saved;
  }
}

function diskReplayHistory() {
  const references: Array<WeakRef<IContent>> = [];
  let pulled = 0;
  let closed = false;
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      try {
        for (let index = 0; index < 512; index += 1) {
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
    state: () => ({ pulled, closed }),
  };
}

/** Staged-rows workspaces currently present in the process scratch root. */
function stagedRowWorkspaces(): string[] {
  return readdirSync(getScratchRoot()).filter((name) =>
    name.startsWith('provider-normalization-'),
  );
}

/** Scratch entries a request creates: staged rows and prompt-key files. */
function requestScratchEntries(): string[] {
  return readdirSync(getScratchRoot())
    .filter(
      (name) =>
        name.startsWith('provider-normalization-') ||
        name.startsWith('responses-prompt-keys-'),
    )
    .sort();
}

function directoryBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directoryBytes(child) : statSync(child).size;
  }
  return total;
}

function retryEndpoint(
  source: ReturnType<typeof diskReplayHistory>,
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
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        hash.update(next.value);
      }
      reader.releaseLock();
      digests.push(hash.digest('hex'));
      const staged = stagedRowWorkspaces();
      expect(staged).toHaveLength(1);
      snapshotSizes.push(directoryBytes(join(getScratchRoot(), staged[0])));
      retainedBytes.push((await settledHeap()) - baselineHeap);
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

describe('staged Responses upload retry', () => {
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

// One full replay scenario; returns the settled heap growth seen at each
// upload. Checked per run so owner facts hold in every run, not just a median.
async function replayScenario(): Promise<number[]> {
  const source = diskReplayHistory();
  const root = mkdtempSync(join(tmpdir(), 'responses-http-test-'));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = root;
  // Snapshots live in the process scratch root; use a fresh one under root.
  removeScratchRoot();
  const endpoint = retryEndpoint(source, await settledHeap());
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
    const expected = createHash('sha256').update(expectedBody()).digest('hex');
    expect(endpoint.digests).toStrictEqual([expected, expected]);
    expect(source.state()).toStrictEqual({ pulled: 512, closed: true });
    expect(output.join('')).toBe('finished');
    for (const count of endpoint.liveCounts)
      expect(count).toBeLessThanOrEqual(2);
    expect(endpoint.snapshotSizes[0]).toBeGreaterThan(9 * 1024 * 1024);
    expect(endpoint.snapshotSizes[1]).toBe(endpoint.snapshotSizes[0]);
    expect(requestScratchEntries()).toStrictEqual([]);
    return endpoint.retainedBytes;
  } finally {
    await endpoint.server.stop(true);
    removeScratchRoot();
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    rmSync(root, { recursive: true, force: true });
  }
}

describe('bounded Responses text HTTP replay', () => {
  it('retries byte-identical text BODY from disk without retaining uploaded rows', async () => {
    // One unmeasured full-size replay takes the one-time state of this path;
    // each upload's 1 MiB bound applies to the median of three measured runs.
    await replayScenario();
    const runs: number[][] = [];
    for (let run = 0; run < 3; run++) runs.push(await replayScenario());
    for (let upload = 0; upload < runs[0].length; upload++)
      expect(median(runs.map((bytes) => bytes[upload]))).toBeLessThan(
        1024 * 1024,
      );
  }, 120000);
});

describe('bounded Responses text HTTP cancellation', () => {
  it('closes the source and removes the scratch files when the HTTP upload is cancelled', async () => {
    const scratchBefore = requestScratchEntries();
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
        expect(source.state().pulled).toBe(512);
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
        pulled: 512,
        closed: true,
      });
      expect(requestScratchEntries()).toStrictEqual(scratchBefore);
    } finally {
      globalThis.fetch = saved;
    }
  });
});
