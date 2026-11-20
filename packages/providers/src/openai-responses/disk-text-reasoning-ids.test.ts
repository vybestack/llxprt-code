/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  startSourceRouteHarness,
  type SourceRouteHarness,
} from './__tests__/support/source-route-harness.js';

const encryptedReasoning = (
  index: number,
  providerId?: string,
): IContent['blocks'] => [
  {
    type: 'thinking',
    thought: `t${index}`,
    sourceField: 'reasoning_content',
    encryptedContent: `enc${index}`,
    ...(providerId === undefined
      ? {}
      : { providerMetadata: { 'openai.responses.reasoningId': providerId } }),
  },
  { type: 'text', text: `a${index}` },
];

const human = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});

const history: readonly IContent[] = [
  human('one'),
  { speaker: 'ai', blocks: encryptedReasoning(0) },
  human('two'),
  { speaker: 'ai', blocks: encryptedReasoning(1) },
  human('three'),
];

const FIXED_CLOCK = 1700000000000;

// Captured by running origin/main's array route over `history` with
// Date.now() fixed at FIXED_CLOCK.
const mainInput = [
  { role: 'user', content: 'one' },
  {
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: 't0' }],
    encrypted_content: 'enc0',
    id: 'rs_1700000000000_0',
  },
  { role: 'assistant', content: 'a0' },
  { role: 'user', content: 'two' },
  {
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: 't1' }],
    encrypted_content: 'enc1',
    id: 'rs_1700000000000_1',
  },
  { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'three' },
];

const inputOf = (body: string): unknown[] =>
  (JSON.parse(body) as { input: unknown[] }).input;

describe('Responses source route synthesized reasoning ids', () => {
  let harness: SourceRouteHarness;
  beforeEach(async () => {
    harness = await startSourceRouteHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('writes the same request bytes as origin/main under a fixed clock', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(FIXED_CLOCK);
    try {
      await harness.sendProjected(harness.options(history, {}));
    } finally {
      clock.mockRestore();
    }
    expect(harness.bodies).toHaveLength(1);
    expect(inputOf(harness.bodies[0])).toStrictEqual(mainInput);
  }, 60000);

  it('mints one time component per request and reuses it across a retry', async () => {
    let tick = FIXED_CLOCK;
    const clock = spyOn(Date, 'now').mockImplementation(() => tick++);
    try {
      harness.failFirst = 1;
      await harness.sendProjected(harness.options(history, {}));
    } finally {
      clock.mockRestore();
    }
    expect(harness.bodies).toHaveLength(2);
    expect(inputOf(harness.bodies[1])).toStrictEqual(
      inputOf(harness.bodies[0]),
    );
    const ids = inputOf(harness.bodies[0]).flatMap((item) => {
      const id = (item as { type?: string; id?: string }).id;
      return id === undefined ? [] : [id];
    });
    expect(ids).toHaveLength(2);
    const [first, second] = ids.map((id) => /^rs_(\d+)_(\d+)$/.exec(id));
    expect(first).not.toBeNull();
    expect(second?.[1]).toBe(first?.[1]);
    expect([first?.[2], second?.[2]]).toStrictEqual(['0', '1']);
  }, 60000);
});
