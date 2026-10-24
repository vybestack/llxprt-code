/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import * as fs from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  nativePrompt,
  nativeRows,
} from './__tests__/native-responses-fixture.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimits: parseOutputLimits({}),
  debug: (): void => {},
};

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
  let passes = 0;
  const contents = {
    ...nativeRows(rows),
    async *openReader() {
      passes++;
      yield* rows;
    },
  };
  const prompt = await nativePrompt(contents, { model: 'gpt-5.6', context });
  try {
    const items: unknown[] = [];
    for await (const item of prompt.items()) items.push(item);
    return { passes, items };
  } finally {
    await prompt.dispose();
  }
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
      if (
        typeof item !== 'object' ||
        item === null ||
        !('type' in item) ||
        !('call_id' in item)
      )
        return [];
      const entry = item;
      return entry.type === 'function_call' ? [entry.call_id] : [];
    });
    const outputIds = items.flatMap((item) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('type' in item) ||
        !('call_id' in item)
      )
        return [];
      const entry = item;
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
