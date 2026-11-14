/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import * as positional from '../../journal/positionalFile.js';

describe('rollback context range notification', () => {
  it('uses saved boundary facts without decoding restored row payloads', async () => {
    await withSuffixFixture(
      512,
      async (history) => {
        const before = history.getContextRange();
        await history.detachedValues.withRollbackCheckpoint(async (restore) => {
          await history.detachedValues.replace([
            { speaker: 'human', blocks: [{ type: 'text', text: 'candidate' }] },
          ]);
          let bytes = 0;
          let parses = 0;
          const createReader = positional.createFileHandleReader;
          const read = spyOn(
            positional,
            'createFileHandleReader',
          ).mockImplementation((handle) => {
            const reader = createReader(handle);
            return {
              readAt: (position, length) => {
                bytes += length;
                return reader.readAt(position, length);
              },
            };
          });
          const parse = JSON.parse;
          const decoding = spyOn(JSON, 'parse').mockImplementation(
            (text, reviver) => {
              parses++;
              return parse(text, reviver);
            },
          );
          try {
            await restore();
            expect(history.getContextRange()).toStrictEqual(before);
            expect(parses).toBeLessThanOrEqual(16);
            expect(bytes).toBeLessThanOrEqual(65536);
          } finally {
            read.mockRestore();
            decoding.mockRestore();
          }
        });
      },
      2048,
    );
  });
});
