import { registerScratchInspection } from '../__tests__/support/scratch-inspection.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { diskAdmittedSource } from '../__tests__/support/disk-admitted-source.js';
import { createHash } from 'node:crypto';
import {
  countO200kBaseTokens,
  getO200kBaseEncoder,
} from '../tokenizers/o200kBaseCounter.js';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  median,
  settledHeap,
} from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
const scratchEntries = registerScratchInspection();

function history(rows = 512, padding = 4096) {
  let opened = 0;
  let pulled = 0;
  let closed = false;
  const sourceRows: Iterable<IContent> = {
    *[Symbol.iterator]() {
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
  return {
    ...diskAdmittedSource(sourceRows),
    state: () => ({ opened, pulled, closed }),
  };
}

function completed(): Response {
  return new Response(
    'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_retry","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function expectedBody(rows = 512, padding = 4096, model = 'o3-mini'): string {
  return JSON.stringify({
    model,
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
  padding = 4096,
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
        while (
          !new TextDecoder().decode(first[first.length - 1]).endsWith('x')
        ) {
          const next = await reader.read();
          if (next.done) throw new Error('Upload ended before its input part');
          first.push(next.value);
        }
        // The producer is admitted before the first byte.
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
    await source.close();
  }
}

const REPLAY_ROW_COUNT = 1024;
const REPLAY_ROW_PADDING = 4096;
// Largest checkpoint in two one-row lifecycle calibrations, before fixture growth.
const REPLAY_FIXED_OVERHEAD_BYTES = 163_082;
const REPLAY_ENCODING_FACTOR = 4;
// The original ceiling remains an independent upper limit on the row formula.
const ORIGINAL_REPLAY_HEAP_BOUND = 1024 * 1024;
const REPLAY_LIVE_ROW_FACTOR = 2;
const REPLAY_LARGEST_ROW_BYTES = Buffer.byteLength(
  JSON.stringify({
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text: `${REPLAY_ROW_COUNT - 1}:${'x'.repeat(REPLAY_ROW_PADDING)}`,
      },
    ],
  }),
);

function diskReplayHistory(rows: number, retain: boolean) {
  let references: Array<WeakRef<IContent>> = [];
  const held: IContent[] = [];
  let pulled = 0;
  let closed = false;
  const sourceRows: Iterable<IContent> = {
    *[Symbol.iterator]() {
      try {
        for (let index = 0; index < rows; index += 1) {
          const row: IContent = {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: `${index}:${'x'.repeat(REPLAY_ROW_PADDING)}`,
              },
            ],
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
    ...diskAdmittedSource(sourceRows, (row) => {
      references.push(new WeakRef(row));
      if (retain) held.push(row);
    }),
    get references(): ReadonlyArray<WeakRef<IContent>> {
      return references;
    },
    pruneCollected(): void {
      references = references.filter(
        (reference) => reference.deref() !== undefined,
      );
    },
    held,
    state: () => ({ pulled, closed }),
  };
}

/** Staged-rows workspaces currently present in the process scratch root. */
function stagedRowWorkspaces(): string[] {
  return scratchEntries().filter((name) =>
    name.startsWith('provider-normalization-'),
  );
}

/** Scratch entries a request creates: staged rows and prompt-key files. */
function requestScratchEntries(): string[] {
  return scratchEntries()
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
  const liveRowBytes: number[] = [];
  const snapshotSizes: number[] = [];
  let largestChunkBytes = 0;
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
        largestChunkBytes = Math.max(largestChunkBytes, next.value.byteLength);
        hash.update(next.value);
      }
      reader.releaseLock();
      digests.push(hash.digest('hex'));
      const staged = stagedRowWorkspaces();
      expect(staged).toHaveLength(0);
      snapshotSizes.push(directoryBytes(source.directory));
      await settledHeap();
      // Dead WeakRef handles belong to the census, not to the request. Keep
      // every live handle so pruning cannot conceal a buffered source row.
      source.pruneCollected();
      retainedBytes.push((await settledHeap()) - baselineHeap);
      liveRowBytes.push(
        source.references.reduce((sum, reference) => {
          const row = reference.deref();
          return (
            sum +
            (row === undefined ? 0 : Buffer.byteLength(JSON.stringify(row)))
          );
        }, 0),
      );
      liveCounts.push(
        source.references.filter((reference) => reference.deref() !== undefined)
          .length,
      );
      return digests.length === 1
        ? new Response('{"error":{"message":"retry"}}', { status: 503 })
        : completed();
    },
  });
  return {
    server,
    digests,
    liveCounts,
    retainedBytes,
    liveRowBytes,
    snapshotSizes,
    largestChunkBytes: () => largestChunkBytes,
  };
}

describe('staged Responses upload retry', () => {
  it('replays an interrupted input part and emits the response once', async () => {
    expect(await runRetry(true, 32, 70_000)).toStrictEqual({
      text: 'finished',
      completeBodies: 1,
    });
  });
  it.each([
    [512, 4096],
    [1, 3 * 1024 * 1024],
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
async function replayScenario(
  rows = REPLAY_ROW_COUNT,
  retain = false,
): Promise<{
  retainedBytes: number[];
  allowance: number;
  largestChunkBytes: number;
}> {
  const source = diskReplayHistory(rows, retain);
  const root = mkdtempSync(join(tmpdir(), 'responses-http-test-'));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = root;
  // Snapshots live in the process scratch root; use a fresh one under root.
  const endpoint = retryEndpoint(source, await settledHeap());
  try {
    const options = streamCallOptions({
      providerName: 'openai-responses',
      contents: source.contents,
      settingsOverrides: {
        provider: { model: 'gpt-5.6', 'prompt-caching': 'off' },
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
      .update(expectedBody(rows, REPLAY_ROW_PADDING, 'gpt-5.6'))
      .digest('hex');
    expect(endpoint.digests).toStrictEqual([expected, expected]);
    expect(source.state()).toStrictEqual({ pulled: rows, closed: true });
    expect(output.join('')).toBe('finished');
    for (const count of endpoint.liveCounts)
      if (retain) expect(count).toBeGreaterThan(2);
      else expect(count).toBeLessThanOrEqual(2);
    for (const bytes of endpoint.liveRowBytes) {
      if (retain)
        expect(bytes).toBeGreaterThan(
          3 * REPLAY_LIVE_ROW_FACTOR * REPLAY_LARGEST_ROW_BYTES,
        );
      else
        expect(bytes).toBeLessThanOrEqual(
          REPLAY_LIVE_ROW_FACTOR * REPLAY_LARGEST_ROW_BYTES,
        );
    }
    expect(endpoint.snapshotSizes[0]).toBeGreaterThan(
      rows * REPLAY_ROW_PADDING,
    );
    expect(endpoint.snapshotSizes[1]).toBe(endpoint.snapshotSizes[0]);
    expect(requestScratchEntries()).toStrictEqual([]);
    // Account for one decoded/UTF-16 row and one receiver chunk, never a body.
    const largestChunkBytes = endpoint.largestChunkBytes();
    const allowance =
      REPLAY_FIXED_OVERHEAD_BYTES +
      REPLAY_ENCODING_FACTOR *
        Math.max(REPLAY_LARGEST_ROW_BYTES, largestChunkBytes);
    expect(allowance).toBeLessThan(1024 * 1024);
    if (rows === REPLAY_ROW_COUNT)
      expect(
        Buffer.byteLength(expectedBody(rows, REPLAY_ROW_PADDING, 'gpt-5.6')),
      ).toBeGreaterThanOrEqual(4 * allowance);
    const evidence = process.env['LANE_G_REPLAY_EVIDENCE'];
    if (evidence !== undefined) {
      const file = Bun.file(evidence);
      const prior = (await file.exists()) ? await file.text() : '';
      await Bun.write(
        evidence,
        prior +
          JSON.stringify({
            rows,
            retain,
            retainedBytes: endpoint.retainedBytes,
            liveCounts: endpoint.liveCounts,
            snapshotSizes: endpoint.snapshotSizes,
            liveRowBytes: endpoint.liveRowBytes,
            largestChunkBytes,
            allowance,
            strictWithin: endpoint.retainedBytes.every(
              (bytes) => bytes < allowance,
            ),
          }) +
          '\n',
      );
    }
    return {
      retainedBytes: endpoint.retainedBytes,
      allowance,
      largestChunkBytes,
    };
  } finally {
    await endpoint.server.stop(true);
    await source.close();
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    rmSync(root, { recursive: true, force: true });
  }
}

describe('bounded Responses text HTTP replay', () => {
  it('calibrates the smallest replay lifecycle', async () => {
    await replayScenario(1);
    const runs = [];
    for (let run = 0; run < 3; run++) runs.push(await replayScenario(1));
    for (let upload = 0; upload < runs[0].retainedBytes.length; upload++)
      expect(median(runs.map((run) => run.retainedBytes[upload]))).toBeLessThan(
        Math.min(...runs.map((run) => run.allowance)),
      );
  }, 120000);
  it('control: retaining replay rows exceeds three times the same allowance', async () => {
    const growth = await replayScenario(REPLAY_ROW_COUNT, true);
    for (const bytes of growth.retainedBytes) {
      expect(bytes).toBeGreaterThan(1024 * 1024);
      expect(bytes).toBeGreaterThan(3 * growth.allowance);
    }
  }, 120000);
  it('keeps the complete replay request inside the route tokenizer window', async () => {
    const encoder = await getO200kBaseEncoder();
    expect(
      countO200kBaseTokens(
        encoder,
        expectedBody(REPLAY_ROW_COUNT, REPLAY_ROW_PADDING, 'gpt-5.6'),
      ) + 1024,
    ).toBeLessThan(1_000_000);
  });
  it.each([REPLAY_ROW_COUNT / 4, REPLAY_ROW_COUNT])(
    'retries byte-identical text BODY from %i admitted rows without retaining uploaded rows',
    async (rows) => {
      // Compare two corpus sizes against the same one-row calibration so
      // per-row fixture or production retention cannot become fixed overhead.
      await replayScenario(rows);
      const runs = [];
      for (let run = 0; run < 3; run++) runs.push(await replayScenario(rows));
      for (let upload = 0; upload < runs[0].retainedBytes.length; upload++)
        expect(
          median(runs.map((run) => run.retainedBytes[upload])),
        ).toBeLessThan(
          Math.min(
            ORIGINAL_REPLAY_HEAP_BOUND,
            ...runs.map((run) => run.allowance),
          ),
        );
    },
    120000,
  );
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
      await source.close();
    }
  });
});
