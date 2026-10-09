/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { deferred } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import {
  clipboardOracle,
  publicChat,
  publicCommandContext,
  publicRow,
  PublicCursorHistory,
} from '../../__tests__/public-history-cursor.js';

let clipboard: (text: string) => Promise<void> = async () => {};
void mock.module('../utils/commandUtils.js', () => ({
  copyToClipboard: (text: string): Promise<void> => clipboard(text),
}));
const { copyCommand } = await import('./copyCommand.js');

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

for (const size of [512, 8192]) {
  describe(`clipboard cursor over ${size} mixed journal rows`, () => {
    it('copies old-path bytes and releases every registered row owner before the clipboard callback settles', async () => {
      const entered = deferred();
      const resume = deferred();
      let output = '';
      clipboard = async (text) => {
        output = text;
        entered.resolve();
        await resume.promise;
      };
      let observed: PublicCursorHistory | undefined;
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          if (!observed) throw new Error('missing observed history');
          const action = copyCommand.action;
          if (!action) throw new Error('missing copy action');
          const result = action(publicCommandContext(publicChat(history)), '');
          await Promise.race([entered.promise, result]);
          try {
            expect(sha(output)).toBe(sha(clipboardOracle(size)));
            expect(Buffer.byteLength(output)).toBeLessThan(8 * 1024 * 1024);
            for (const owner of [reader, observed.borrowed, observed.copies]) {
              expect(owner.snapshot().liveRows).toBe(0);
              expect(owner.snapshot().peakRows).toBe(1);
              expect(
                owner.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
              ).toBe(true);
            }
            expect(counters.snapshot().rowsDecoded).toBe(size);
          } finally {
            resume.resolve();
          }
          expect(await result).toMatchObject({
            messageType: 'info',
            content: 'Last output copied to the clipboard',
          });
          output = '';
        },
        2048,
        publicRow,
        undefined,
        (options) => {
          observed = new PublicCursorHistory(options);
          return observed;
        },
      );
    }, 120_000);
  });

  describe(`clipboard cancellation over ${size} mixed rows`, () => {
    it('cancels a paused read and leaves no clipboard side effect or retained reader/copy', async () => {
      const entered = deferred();
      const resume = deferred();
      const controller = new AbortController();
      let writes = 0;
      clipboard = async () => {
        writes++;
      };
      let observed: PublicCursorHistory | undefined;
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          if (!observed) throw new Error('missing observed history');
          observed.beforeYield = async (index) => {
            if (index !== 4) return;
            entered.resolve();
            await resume.promise;
          };
          const result = copyCommand.action?.(
            publicCommandContext(publicChat(history), controller.signal),
            '',
          );
          const settled = Promise.resolve(result).catch(
            (error: unknown) => error,
          );
          await Promise.race([entered.promise, settled]);
          try {
            expect(counters.snapshot()).toMatchObject({
              rowsDecoded: 5,
              peakDecodedRows: 1,
            });
            for (const owner of [reader, observed.borrowed, observed.copies])
              expect(owner.snapshot().liveRows).toBe(1);
          } finally {
            controller.abort(new Error('cancel copy'));
            resume.resolve();
          }
          expect(await settled).toMatchObject({ message: 'cancel copy' });
          expect(counters.snapshot().rowsDecoded).toBe(5);
          expect(writes).toBe(0);
          for (const owner of [reader, observed.borrowed, observed.copies])
            expect(owner.snapshot().liveRows).toBe(0);
        },
        2048,
        publicRow,
        undefined,
        (options) => {
          observed = new PublicCursorHistory(options);
          return observed;
        },
      );
    }, 120_000);
  });

  describe(`clipboard snapshot stability over ${size} mixed rows`, () => {
    it('finishes the pinned clipboard snapshot after live history is cleared during a paused row callback', async () => {
      const entered = deferred();
      const resume = deferred();
      let output = '';
      clipboard = async (text) => {
        output = text;
      };
      let observed: PublicCursorHistory | undefined;
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          if (!observed) throw new Error('missing observed history');
          observed.beforeYield = async (index) => {
            if (index !== 4) return;
            entered.resolve();
            await resume.promise;
          };
          const result = copyCommand.action?.(
            publicCommandContext(publicChat(history)),
            '',
          );
          await Promise.race([entered.promise, result]);
          try {
            expect(counters.snapshot()).toMatchObject({
              rowsDecoded: 5,
              peakDecodedRows: 1,
            });
            for (const owner of [reader, observed.borrowed, observed.copies]) {
              expect(owner.snapshot().liveRows).toBe(1);
              expect(
                owner.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
              ).toBe(true);
            }
            history.clear();
          } finally {
            resume.resolve();
          }
          await result;
          expect(sha(output)).toBe(sha(clipboardOracle(size)));
          expect(counters.snapshot().rowsDecoded).toBe(size);
          for (const owner of [reader, observed.borrowed, observed.copies])
            expect(owner.snapshot().liveRows).toBe(0);
        },
        2048,
        publicRow,
        undefined,
        (options) => {
          observed = new PublicCursorHistory(options);
          return observed;
        },
      );
    }, 120_000);
  });
}

describe('clipboard cursor failures and large rows', () => {
  it('accepts a last AI row larger than 8 MiB without truncating clipboard bytes', async () => {
    const bytes = 8 * 1024 * 1024 + 123;
    let actual = '';
    clipboard = async (text) => {
      actual = sha(text);
    };
    await withSuffixFixture(
      2,
      async (history, owner) => {
        await copyCommand.action?.(
          publicCommandContext(publicChat(history)),
          '',
        );
        expect(actual).toBe(sha(clipboardOracle(2, bytes)));
        expect(owner.snapshot().peakSerializedBytes).toBeGreaterThan(
          8 * 1024 * 1024,
        );
        expect(owner.snapshot().peakRows).toBe(1);
        expect(owner.snapshot().liveRows).toBe(0);
      },
      bytes,
      publicRow,
      undefined,
      (options) => new PublicCursorHistory(options),
    );
  }, 120_000);

  it('propagates source failure before clipboard publication and releases copies', async () => {
    let observed: PublicCursorHistory | undefined;
    let writes = 0;
    clipboard = async () => {
      writes++;
    };
    await withSuffixFixture(
      6,
      async (history, reader) => {
        if (!observed) throw new Error('missing observed history');
        observed.beforeYield = async (index) => {
          if (index === 3) throw new Error('journal read fault');
        };
        await expect(
          copyCommand.action?.(publicCommandContext(publicChat(history)), ''),
        ).rejects.toThrow('journal read fault');
        expect(writes).toBe(0);
        for (const owner of [reader, observed.borrowed, observed.copies])
          expect(owner.snapshot().liveRows).toBe(0);
      },
      2048,
      publicRow,
      undefined,
      (options) => {
        observed = new PublicCursorHistory(options);
        return observed;
      },
    );
  });

  it('reports clipboard failure only after reader cleanup', async () => {
    clipboard = async () => {
      throw new Error('clipboard fault');
    };
    await withSuffixFixture(
      6,
      async (history, reader) => {
        const result = await copyCommand.action?.(
          publicCommandContext(publicChat(history)),
          '',
        );
        expect(result).toMatchObject({
          messageType: 'error',
          content: 'Failed to copy to the clipboard. clipboard fault',
        });
        expect(reader.snapshot().liveRows).toBe(0);
      },
      2048,
      publicRow,
      undefined,
      (options) => new PublicCursorHistory(options),
    );
  });
});
