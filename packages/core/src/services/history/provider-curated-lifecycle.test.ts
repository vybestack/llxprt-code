/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { DebugLogger } from '../../debug/index.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { openNativeProviderFixture } from './__tests__/support/native-provider-fixture.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import { providerFixtureRow } from './__tests__/support/provider-curated-test-helpers.js';
import type { IContent } from './IContent.js';

const logger = new DebugLogger('test:provider-lifecycle');
async function* source(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++)
    yield providerFixtureRow(index, bytes);
}
async function* nativeRows(
  size: number,
  bytes = 2048,
  ownership?: RowOwnership,
): AsyncGenerator<IContent, void, unknown> {
  const snapshot = await openNativeProviderFixture(
    tmpdir(),
    source(size, bytes),
    size,
    ownership,
  );
  try {
    yield* snapshot.openReader();
  } finally {
    await snapshot.close();
  }
}
describe('provider row-local bounds and counter controls', () => {
  for (const size of [512, 8192]) {
    it(`keeps explicit output ownership bounded for ${size} rows and detects a retaining consumer`, async () => {
      const owned = new RowOwnership();
      for await (const row of nativeRows(size, 2048, owned)) {
        void row;
      }
      expect(owned.snapshot().liveRows).toBe(0);
      expect(
        owned.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      const retained = new RowOwnership();
      const trap: IContent[] = [];
      for await (const row of nativeRows(
        size,
        size === 512 ? 128 * 1024 : 16 * 1024,
      )) {
        retained.retain(row);
        trap.push(row);
      }
      expect(retained.snapshot().peakRows).toBeGreaterThan(440);
      expect(retained.snapshot().peakSerializedBytes).toBeGreaterThan(
        8 * 1024 * 1024,
      );
      expect(
        retained.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(false);
      for (const row of trap) retained.release(row);
      expect(retained.snapshot().liveRows).toBe(0);
    }, 120_000);
  }
});

describe('provider response scoring', () => {
  it('retains old duplicate-response scoring when a JSON value serializes to null', async () => {
    const rows: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'score', name: 't', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'score',
            toolName: 'first',
            result: NaN,
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'score',
            toolName: 'second',
            result: 1,
          },
        ],
      },
    ];
    async function* input(): AsyncGenerator<IContent, void, unknown> {
      yield* rows;
    }
    const result: IContent[] = [];
    const snapshot = await openNativeProviderFixture(
      tmpdir(),
      input(),
      rows.length,
    );
    try {
      for await (const row of snapshot.openReader()) result.push(row);
    } finally {
      await snapshot.close();
    }
    expect(JSON.stringify(result)).toBe(
      JSON.stringify(buildProviderContent(rows, [], logger)),
    );
  });
});
