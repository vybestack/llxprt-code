/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { RequestScopedContents } from '../utils/requestScopedBody.js';
import { ResponsesSourceInput } from './responses-source-input.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};

/** Counts every pass over the stored request rows. */
class CountingContents implements RequestScopedContents {
  passes = 0;
  readonly isMaterialized = false;
  constructor(private readonly rows: readonly IContent[]) {}
  async *stream(): AsyncIterableIterator<IContent> {
    this.passes += 1;
    for (const row of this.rows) yield row;
  }
  materialize(): Promise<IContent[]> {
    return Promise.resolve([...this.rows]);
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

function exchange(index: number, answered: boolean): IContent[] {
  const rows: IContent[] = [
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: `hist_tool_${index}`,
          name: 'lookup',
          parameters: { index },
        },
      ],
    },
  ];
  if (answered)
    rows.push({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: `hist_tool_${index}`,
          toolName: 'lookup',
          result: `result ${index}`,
        },
      ],
    });
  return rows;
}

async function write(
  rows: readonly IContent[],
): Promise<{ passes: number; items: unknown[] }> {
  const contents = new CountingContents(rows);
  let text = '';
  await new ResponsesSourceInput(
    {
      append: (value) => {
        text += value;
      },
      value: (value) => {
        text += JSON.stringify(value);
      },
    },
    context,
    '/dev/null',
  ).write(contents);
  return {
    passes: contents.passes,
    items: JSON.parse(text.replaceAll('}{', '},{')) as unknown[],
  };
}

describe('Responses source tool-pair membership', () => {
  it('reads the stored rows a fixed number of times however many tool calls exist', async () => {
    const small = await write(
      Array.from({ length: 3 }, (_, i) => exchange(i, true)).flat(),
    );
    const large = await write(
      Array.from({ length: 120 }, (_, i) => exchange(i, true)).flat(),
    );
    expect(large.passes).toBe(small.passes);
    expect(large.passes).toBeLessThanOrEqual(3);
    expect(large.items).toHaveLength(240);
  });

  it('keeps paired calls and responses and drops an unpaired response', async () => {
    const orphan: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_orphan',
          toolName: 'lookup',
          result: 'no call',
        },
      ],
    };
    const { items } = await write([
      ...exchange(0, true),
      orphan,
      ...exchange(1, true),
    ]);
    const callIds = items.flatMap((item) => {
      const entry = item as { type?: string; call_id?: string };
      return entry.type === 'function_call' ? [entry.call_id] : [];
    });
    const outputIds = items.flatMap((item) => {
      const entry = item as { type?: string; call_id?: string };
      return entry.type === 'function_call_output' ? [entry.call_id] : [];
    });
    expect(callIds).toHaveLength(2);
    expect(outputIds).toStrictEqual(callIds);
  });

  it('removes the pairing index scratch directory after the write', async () => {
    const before = new Set(fs.readdirSync(getScratchRoot()));
    await write(Array.from({ length: 4 }, (_, i) => exchange(i, true)).flat());
    expect(
      fs.readdirSync(getScratchRoot()).filter((name) => !before.has(name)),
    ).toStrictEqual([]);
  });
});
