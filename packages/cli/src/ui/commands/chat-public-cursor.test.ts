/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { deferred } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { chatCommand } from './chatCommand.js';
import {
  publicChat,
  publicCommandContext,
  publicRow,
  PublicCursorHistory,
} from '../../__tests__/public-history-cursor.js';

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

for (const size of [512, 8192]) {
  describe(`public chat cursor over ${size} mixed rows`, () => {
    it('prints the original diagnostic count without arrays and with bounded reader ownership', async () => {
      await withSuffixFixture(
        size,
        async (history, reader) => {
          const debug = chatCommand.subCommands?.find(
            (command) => command.name === 'debug',
          );
          const result = await debug?.action?.(
            publicCommandContext(publicChat(history)),
            '',
          );
          expect(result).toMatchObject({
            messageType: 'info',
            content: `Chat Debug Information:\n• Chat initialized: true\n• History entries: ${size}\n• Current model: unavailable\n• Recording: not active`,
          });
          expect(reader.snapshot().peakRows).toBe(1);
          expect(reader.snapshot().liveRows).toBe(0);
          expect(reader.within(bounds)).toBe(true);
        },
        2048,
        publicRow,
        undefined,
        (options) => new PublicCursorHistory(options),
      );
    }, 120_000);

    it('pins membership on first next across clear and closes on early consumer return', async () => {
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          const chat = publicChat(history);
          const unused = chat.streamHistory();
          await unused.return();
          expect(reader.snapshot().acquisitions).toBe(0);
          const cursor = chat.streamHistory();
          const first = await cursor.next();
          expect(first.value).toStrictEqual(publicRow(0));
          expect(counters.snapshot().rowsDecoded).toBe(1);
          history.clear();
          const second = await cursor.next();
          expect(second.value).toStrictEqual(publicRow(1));
          await cursor.return();
          expect(reader.snapshot().liveRows).toBe(0);
          expect((await chat.streamHistory().next()).done).toBe(true);
        },
        2048,
        publicRow,
        undefined,
        (options) => new PublicCursorHistory(options),
      );
    }, 120_000);
  });

  describe(`retaining consumer controls over ${size} mixed rows`, () => {
    it('rejects the fixed owner bounds for deliberately retained borrowed rows and distinct external copies', async () => {
      await withSuffixFixture(
        size,
        async (history, reader) => {
          const borrowed = new RowOwnership();
          const external = new RowOwnership();
          const retained: IContent[] = [];
          const copies: IContent[] = [];
          try {
            for await (const row of publicChat(history).streamHistory()) {
              borrowed.retain(row);
              retained.push(row);
              const copy = { ...row, blocks: [...row.blocks] };
              external.retain(copy);
              copies.push(copy);
            }
            expect(borrowed.snapshot().peakRows).toBe(size);
            expect(external.snapshot().peakRows).toBe(size);
            expect(borrowed.within(bounds)).toBe(false);
            expect(external.within(bounds)).toBe(false);
            expect(
              borrowed.snapshot().peakSerializedBytes > bounds.serializedBytes,
            ).toBe(size === 8192);
            expect(
              external.snapshot().peakSerializedBytes > bounds.serializedBytes,
            ).toBe(size === 8192);
            expect(reader.snapshot().liveRows).toBe(0);
          } finally {
            for (const row of retained) borrowed.release(row);
            for (const row of copies) external.release(row);
            retained.length = 0;
            copies.length = 0;
          }
          expect(borrowed.snapshot().liveRows).toBe(0);
          expect(external.snapshot().liveRows).toBe(0);
        },
        2048,
        publicRow,
        undefined,
        (options) => new PublicCursorHistory(options),
      );
    }, 120_000);
  });
}

describe('public chat cursor cancellation', () => {
  it('rejects pre-abort without reading rows', async () => {
    await withSuffixFixture(
      2,
      async (history, reader) => {
        const controller = new AbortController();
        controller.abort(new Error('pre-abort'));
        await expect(
          publicChat(history).streamHistory(controller.signal).next(),
        ).rejects.toThrow('pre-abort');
        expect(reader.snapshot().acquisitions).toBe(0);
      },
      2048,
      publicRow,
      undefined,
      (options) => new PublicCursorHistory(options),
    );
  });

  it('does not swallow debug cancellation as an unavailable-history diagnostic', async () => {
    const entered = deferred();
    const resume = deferred();
    const controller = new AbortController();
    let observed: PublicCursorHistory | undefined;
    await withSuffixFixture(
      6,
      async (history, reader, counters) => {
        if (!observed) throw new Error('missing observed history');
        observed.beforeYield = async () => {
          entered.resolve();
          await resume.promise;
        };
        const debug = chatCommand.subCommands?.find(
          (command) => command.name === 'debug',
        );
        const result = debug?.action?.(
          publicCommandContext(publicChat(history), controller.signal),
          '',
        );
        await Promise.race([entered.promise, result]);
        controller.abort(new Error('cancel diagnostics'));
        resume.resolve();
        await expect(result).rejects.toThrow('cancel diagnostics');
        expect(counters.snapshot().rowsDecoded).toBe(1);
        expect(reader.snapshot().liveRows).toBe(0);
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
});
