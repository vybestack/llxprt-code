/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type {
  RowFormatSettings,
  RowLengthFacts,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { encodedRows } from '@vybestack/llxprt-code-core/services/history/journalPublication.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { responsesLengthRegistration } from './journal-responses-length.js';

const settings: RowFormatSettings = {
  formatId: 'responses',
  formatRev: 1,
  model: 'fill-allocation',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
};

function* rows(count: number): Generator<IContent> {
  for (let index = 0; index < count; index++)
    yield {
      speaker: 'human',
      blocks: [{ type: 'text', text: `${index}:雪\\"${'x'.repeat(16384)}` }],
    };
}

async function observeBlocks(
  snapshot: VersionSnapshot,
  blocks: Array<WeakRef<Uint8Array>>,
  retained: Uint8Array[],
  operation: () => Promise<RowLengthFacts>,
): Promise<RowLengthFacts> {
  const readBlock = snapshot.readBlock;
  snapshot.readBlock = async (...args) => {
    const block = await readBlock.apply(snapshot, args);
    blocks.push(new WeakRef(block));
    if (process.env.ISSUE854_FILL_ROW_TRAP === 'retain') retained.push(block);
    return block;
  };
  try {
    return await operation();
  } finally {
    snapshot.readBlock = readBlock;
  }
}

describe('cold Responses format allocation', () => {
  for (const count of [64, 256]) {
    it(`measures ${count} rows without serializing payloads or retaining decoded block buffers`, async () => {
      const session = await JournalSession.createUnlinked();
      const stringify = JSON.stringify;
      let largestSerialized = 0;
      const retained: Uint8Array[] = [];
      try {
        await session.store.commit([
          { kind: 'replace', rows: encodedRows(rows(count), 0) },
        ]);
        const registration = responsesLengthRegistration(settings);
        const blocks: Array<WeakRef<Uint8Array>> = [];
        let peakLive = 0;
        let measured = 0;
        JSON.stringify = new Proxy(stringify, {
          apply(target, receiver: unknown, args: unknown[]): unknown {
            const encoded: unknown = Reflect.apply(target, receiver, args);
            if (typeof encoded === 'string')
              largestSerialized = Math.max(largestSerialized, encoded.length);
            return encoded;
          },
        });
        await session.registerRowFormat({
          ...registration,
          measure: async (snapshot, entry, captured) => {
            const facts = await observeBlocks(snapshot, blocks, retained, () =>
              registration.measure(snapshot, entry, captured),
            );
            measured++;
            if (measured % 16 === 0) {
              await setImmediate();
              Bun.gc(true);
              peakLive = Math.max(
                peakLive,
                blocks.filter((block) => block.deref() !== undefined).length,
              );
              blocks.length = 0;
            }
            return facts;
          },
        });
        expect(measured).toBe(count);
        expect(largestSerialized).toBeLessThan(1024);
        expect(peakLive).toBeLessThanOrEqual(1);
      } finally {
        JSON.stringify = stringify;
        retained.length = 0;
        await session.close();
      }
    });
  }
});
