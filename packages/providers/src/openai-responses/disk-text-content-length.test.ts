/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A3 (GitHub #3847): the `openai-responses` provider's disk
 * text route sends its request with a Content-Length equal to the body bytes.
 *
 * Every case drives the real provider against a stubbed global `fetch`, reads
 * the bytes the transport was handed and compares them with the declared
 * header. The body is never built in memory to measure it: the length comes
 * from the on-disk segments.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type CapturedWireRequest,
  WIRE_ROUTES,
  sendThroughRoute,
} from '../__tests__/support/wireBodyCapture.js';
import { createCorpus } from '../__tests__/support/wireBodyCorpus.js';
import { PINNED_CLOCK } from '../__tests__/support/wireBodyFixtures.js';
import type { HistoryCase } from '../__tests__/support/wireBodyHistories.js';
import { ProgressiveJsonBody } from '../utils/progressive-json-body.js';

const route = WIRE_ROUTES.find((entry) => entry.id === 'openai-responses');
if (route === undefined) throw new Error('openai-responses route is missing');

const corpus = await createCorpus();

function corpusHistory(id: string): HistoryCase {
  const history = corpus.histories.find((entry) => entry.id === id);
  if (history === undefined) throw new Error(`corpus has no history ${id}`);
  return history;
}

/** The Content-Length header text and the body byte count, both as text. */
function declaredAndSent(request: CapturedWireRequest): {
  readonly declared: string | null;
  readonly sent: string;
} {
  return {
    declared: request.contentLength,
    sent: `${request.bytes.byteLength}`,
  };
}

/** Instructions whose UTF-16 file is longer than one 8 KiB read. */
function longInstructions(): string {
  const unit = 'abc \ud83d\ude00 \u2028 "q" \\ ';
  let text = '';
  while (text.length < 4090) text += unit;
  // A surrogate pair and then a lone high surrogate land across the first
  // 4096-code-unit read boundary.
  text = text.slice(0, 4095) + '\ud83d\ude00' + '\ud800' + 'tail \udc00 end';
  return text;
}

function toolHeavyRows(pairs: number): IContent[] {
  const rows: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
  ];
  for (let index = 0; index < pairs; index++) {
    const id = `hist_call_${index}`;
    rows.push(
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id,
            name: 'read_file',
            parameters: { path: `/tmp/file-${index}.txt`, '10': index },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: id,
            toolName: 'read_file',
            result: `line one\nline "two" \u2028 ${'x'.repeat(200)}`,
          },
        ],
      },
    );
  }
  rows.push({ speaker: 'human', blocks: [{ type: 'text', text: 'done' }] });
  return rows;
}

describe('openai-responses disk text route Content-Length', () => {
  beforeAll(() => {
    setSystemTime(new Date(PINNED_CLOCK));
  });

  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });

  it('sends Content-Length equal to the body for a text history', async () => {
    const request = await sendThroughRoute(
      route,
      corpusHistory('text-only'),
      'rows',
    );
    const { declared, sent } = declaredAndSent(request);
    expect(declared).toBe(sent);
  });

  it('sends Content-Length equal to the body for inline media', async () => {
    const request = await sendThroughRoute(
      route,
      corpusHistory('media-inline-image'),
      'rows',
    );
    const { declared, sent } = declaredAndSent(request);
    expect(declared).toBe(sent);
    expect(new TextDecoder().decode(request.bytes)).toContain(
      'data:image/png;base64,',
    );
  });

  it('sends Content-Length equal to the body for a media reference resolved at send', async () => {
    const request = await sendThroughRoute(
      route,
      corpusHistory('media-reference-image'),
      'rows',
      corpus.binding,
    );
    const { declared, sent } = declaredAndSent(request);
    expect(declared).toBe(sent);
  });

  it('sends Content-Length equal to the body for a tool-heavy history with tools', async () => {
    const history: HistoryCase = {
      id: 'tool-heavy-a3',
      description: 'many tool round trips',
      rows: toolHeavyRows(120),
      systemInstruction: 'You are a terse assistant.',
      tools: corpusHistory('system-and-tools').tools,
    };
    const request = await sendThroughRoute(route, history, 'rows');
    const { declared, sent } = declaredAndSent(request);
    expect(declared).toBe(sent);
    expect(request.bytes.byteLength).toBeGreaterThan(16 * 1024);
  });

  it('counts UTF-16 instructions with lone surrogates, U+2028 and a read-boundary pair', async () => {
    const instructions = longInstructions();
    const history: HistoryCase = {
      id: 'utf16-instructions-a3',
      description: 'instructions that need JSON escaping across reads',
      rows: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
      systemInstruction: instructions,
    };
    const request = await sendThroughRoute(route, history, 'rows');
    const { declared, sent } = declaredAndSent(request);
    expect(declared).toBe(sent);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(request.bytes));
    expect(parsed).toMatchObject({ instructions });
  });

  it('sends Content-Length for a stateful parent request', async () => {
    const request = await sendThroughRoute(
      route,
      corpusHistory('responses-stateful-parent'),
      'rows',
    );
    const { declared, sent } = declaredAndSent(request);
    expect(declared).toBe(sent);
  });
});

describe('ProgressiveJsonBody declared length', () => {
  async function drain(body: ProgressiveJsonBody): Promise<number> {
    const handle = body.createStreamHandle();
    const reader = handle.stream.getReader();
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) return total;
        total += next.value.byteLength;
      }
    } finally {
      reader.releaseLock();
      await handle.dispose();
      await body.dispose();
    }
  }

  async function* chunks(...sizes: number[]): AsyncGenerator<Uint8Array, void> {
    for (const size of sizes) yield new Uint8Array(size);
  }

  it('serves exactly the declared length', async () => {
    const body = new ProgressiveJsonBody(() => chunks(3, 4), 7);
    expect(body.byteLength).toBe(7);
    expect(await drain(body)).toBe(7);
  });

  it('has no length unless one was declared', () => {
    expect(new ProgressiveJsonBody(() => chunks(3)).byteLength).toBeUndefined();
  });

  it('fails the stream when fewer bytes are served than declared', async () => {
    const body = new ProgressiveJsonBody(() => chunks(3, 3), 7);
    await expect(drain(body)).rejects.toThrow(
      'Request body served 6 bytes but declared 7',
    );
  });

  it('fails the stream when more bytes are served than declared', async () => {
    const body = new ProgressiveJsonBody(() => chunks(3, 5), 7);
    await expect(drain(body)).rejects.toThrow(
      'Request body served 8 bytes but declared 7',
    );
  });
});
