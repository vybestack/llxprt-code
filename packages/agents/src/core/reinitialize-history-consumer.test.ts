/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  accountingFactory,
  deferred,
} from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { expectedHistoryDigest } from './orchestrator-history-test-helpers.js';
import {
  historyDigest,
  reinitializeBounds,
  reinitializeConfig,
  recordReinitializeOwners,
  withReinitializeHistory,
} from './reinitialize-history-test-helpers.js';

for (const size of [512, 8192]) {
  describe(`paused active-history token consumer at ${size}`, () => {
    it('charges the actual pending consumer and rolls back its injected tokenizer failure', async () => {
      await withReinitializeHistory(
        size,
        async (client, _source, owners, config) => {
          const entered = deferred();
          const release = deferred();
          const fault = new Error('candidate tokenizer consumer failed');
          let visited = 0;
          config.setTokenizerFactory(
            accountingFactory(async (text) => {
              visited++;
              if (text.startsWith('row:31:')) {
                entered.resolve();
                await release.promise;
                throw fault;
              }
              return text.length;
            }),
          );
          const result = client
            .initialize(reinitializeConfig(config), { ownership: owners })
            .then(
              () => undefined,
              (error: unknown) => error,
            );
          await Promise.race([
            entered.promise,
            result.then(() => {
              throw new Error('Consumer ended before pause');
            }),
          ]);
          const activeDuringPause = client.hasChatInitialized();
          try {
            const callsBeforeYield = visited;
            expect(owners.snapshot().liveRows).toBeGreaterThan(0);
            expect(owners.within(reinitializeBounds)).toBe(true);
            await Promise.resolve();
            expect({ before: callsBeforeYield, after: visited }).toStrictEqual({
              before: 125,
              after: 125,
            });
            recordReinitializeOwners(size, 'paused-token-consumer', owners);
          } finally {
            release.resolve();
          }
          expect(await result).toBe(fault);
          expect({
            paused: activeDuringPause,
            failed: client.hasChatInitialized(),
          }).toStrictEqual({ paused: true, failed: true });
          expect(await historyDigest(client.streamHistory())).toStrictEqual({
            count: size,
            digest: expectedHistoryDigest(size),
          });
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    }, 180000);
  });
}
