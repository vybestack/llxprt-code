/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withPublicHistory,
  StreamOnlyHistory,
} from '../api/__tests__/helpers/public-history-fixture.js';
import { internalConfig } from '../api/__tests__/helpers/agentHarness.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { ChatSession } from './chatSession.js';
import { publicDefaultBounds } from './public-default-history-test-helpers.js';

for (const size of [512, 8192]) {
  for (const explicitFalse of [false, true]) {
    describe(`real chat reader ${size} false=${explicitFalse}`, () => {
      it('is cold, pins on first next, survives replacement and releases on return', async () => {
        await withPublicHistory(
          size,
          true,
          async (agent, history, reader, decoded) => {
            const chat = internalConfig(agent).getAgentClient().getChat();
            if (!(chat instanceof ChatSession))
              throw new Error('Expected real chat');
            const unused = explicitFalse
              ? chat.getHistory(false)
              : chat.getHistory();
            await unused.return();
            expect(decoded()).toBe(0);
            const source = explicitFalse
              ? chat.getHistory(false)
              : chat.getHistory();
            expect((await source.next()).value).toStrictEqual(accountingRow(0));
            history.add(accountingRow(size));
            await history.waitForCommit();
            expect({
              held: reader.snapshot().liveRows,
              decoded: decoded(),
            }).toStrictEqual({ held: 1, decoded: 1 });
            expect((await source.next()).value).toStrictEqual(accountingRow(1));
            history.clear();
            expect((await source.next()).value).toStrictEqual(accountingRow(2));
            await source.return();
            expect(reader.snapshot().liveRows).toBe(0);
            expect((await chat.getHistory().next()).done).toBe(true);
            expect(reader.within(publicDefaultBounds)).toBe(true);
          },
        );
      }, 180_000);

      it('releases pinned readers after abort, source errors and consumer errors', async () => {
        await withPublicHistory(size, true, async (agent, history, reader) => {
          const chat = internalConfig(agent).getAgentClient().getChat();
          if (!(history instanceof StreamOnlyHistory))
            throw new Error('Expected controlled disk source');
          const controller = new AbortController();
          const cursor = chat.getHistory(false, controller.signal);
          await cursor.next();
          controller.abort(new Error('chat history abort'));
          await expect(cursor.next()).rejects.toThrow('chat history abort');
          history.failAfter = 3;
          async function drainFault(): Promise<void> {
            for await (const row of chat.getHistory()) void row;
          }
          await expect(drainFault()).rejects.toThrow('raw source fault');
          history.failAfter = undefined;
          async function consumerFault(): Promise<void> {
            for await (const _row of chat.getHistory(false))
              throw new Error('chat consumer fault');
          }
          await expect(consumerFault()).rejects.toThrow('chat consumer fault');
          expect(reader.snapshot().liveRows).toBe(0);
          expect(reader.within(publicDefaultBounds)).toBe(true);
        });
      }, 180_000);
    });
  }
}
