/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { appendFileSync } from 'node:fs';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  withSuffixFixture,
  rowIndex,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import { AgentClient } from './client.js';
import { randomUUID } from 'node:crypto';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { accountingFactory } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

async function buildDeferredClient(): Promise<{
  client: AgentClient;
  config: Config;
  store: LocalMediaStore;
  cleanup: () => Promise<void>;
}> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  const config = internalConfig(agent);
  config.setTokenizerFactory(accountingFactory((text) => text.length));
  const client = new AgentClient(
    config,
    createAgentRuntimeState({
      runtimeId: randomUUID(),
      provider: 'fake',
      model: 'fake-model',
    }),
  );
  return {
    client,
    config,
    store: config.getLocalMediaStore(),
    cleanup: async () => {
      await client.dispose();
      await cleanup();
    },
  };
}

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

function recordOwnership(size: number, owners: RowOwnership): void {
  const output = process.env.DEFERRED_ADMISSION_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      `${JSON.stringify({ size, paused: owners.snapshot() })}
`,
    );
}

async function nextContent(
  stream: AsyncGenerator<IContent, void, unknown>,
): Promise<IContent> {
  const next = await stream.next();
  if (next.done === true) throw new Error('Missing admitted row');
  return next.value;
}

describe('streamed deferred history admission', () => {
  for (const size of [512, 8192]) {
    describe(`disk deferred admission at ${size}`, () => {
      it('commits detached rows without retaining the source and pins only the paused output row', async () => {
        await withSuffixFixture(
          size,
          async (source, owners) => {
            const { client, cleanup } = await buildDeferredClient();
            const counters = createRowCounters();
            try {
              await client.storeHistoryForLaterUse(source.streamRawHistory(), {
                ownership: owners,
                counters: { ...counters.counters, ownership: owners },
              });
              expect(client.hasChatInitialized()).toBe(false);
              expect(owners.snapshot().liveRows).toBe(0);
              expect(owners.within(bounds)).toBe(true);
              source.clear();
              const stream = client.streamHistory();
              const first = await stream.next();
              if (first.done === true) throw new Error('No admitted history');
              owners.retain(first.value);
              try {
                expect(rowIndex(first.value)).toBe(0);
                expect(owners.snapshot().liveRows).toBe(1);
                recordOwnership(size, owners);
                await client.startChat([]);
                expect(rowIndex(await nextContent(stream))).toBe(1);
              } finally {
                await stream.return();
                owners.release(first.value);
              }
              let count = 0;
              for await (const row of client.streamHistory()) {
                expect(rowIndex(row)).toBe(count++);
              }
              expect(count).toBe(size);
              expect(owners.snapshot().liveRows).toBe(0);
            } finally {
              await cleanup();
            }
          },
          2048,
        );
      }, 120_000);
    });
  }
});

describe('deferred source failures and oversized rows', () => {
  it('rolls back a source failure and cancellation without changing admitted history', async () => {
    const { client, cleanup } = await buildDeferredClient();
    const previous: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'previous' }],
    };
    const abort = new AbortController();
    async function* failing(): AsyncIterable<IContent> {
      yield { speaker: 'human', blocks: [{ type: 'text', text: 'candidate' }] };
      throw new Error('disk source failed');
    }
    async function* cancelled(): AsyncIterable<IContent> {
      yield { speaker: 'human', blocks: [{ type: 'text', text: 'cancelled' }] };
      abort.abort(new Error('source cancelled'));
    }
    try {
      await client.storeHistoryForLaterUse([previous]);
      await expect(client.storeHistoryForLaterUse(failing())).rejects.toThrow(
        'disk source failed',
      );
      expect(
        (await Array.fromAsync(client.getHistory())).map((row) => row.blocks),
      ).toStrictEqual([previous.blocks]);
      await expect(
        client.storeHistoryForLaterUse(cancelled(), { signal: abort.signal }),
      ).rejects.toThrow('source cancelled');
      expect(
        (await Array.fromAsync(client.getHistory())).map((row) => row.blocks),
      ).toStrictEqual([previous.blocks]);
    } finally {
      await cleanup();
    }
  });

  it('accepts a valid disk row larger than the aggregate byte limit', async () => {
    await withSuffixFixture(
      1,
      async (source) => {
        const { client, cleanup } = await buildDeferredClient();
        try {
          await client.storeHistoryForLaterUse(source.streamRawHistory());
          const stream = client.streamHistory();
          try {
            const first = await stream.next();
            if (first.done === true) throw new Error('Missing oversized row');
            const block = first.value.blocks[0];
            if (block.type !== 'text') throw new Error('Expected text');
            expect(block.text.length).toBe(9 * 1024 * 1024 + 2);
            expect((await stream.next()).done).toBe(true);
          } finally {
            await stream.return();
          }
        } finally {
          await cleanup();
        }
      },
      9 * 1024 * 1024,
    );
  }, 120_000);
});

describe('paused deferred source', () => {
  it('charges the paused admission source until serialization completes', async () => {
    const owners = new RowOwnership();
    const { client, cleanup } = await buildDeferredClient();
    let resume: () => void = () => {};
    let entered: () => void = () => {};
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    async function* source(): AsyncIterable<IContent> {
      const row: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'x'.repeat(2048) }],
      };
      owners.retain(row);
      try {
        yield row;
        entered();
        await proceed;
      } finally {
        owners.release(row);
      }
    }
    const admission = client.storeHistoryForLaterUse(source());
    try {
      await paused;
      expect(owners.snapshot().liveRows).toBe(1);
      expect(owners.within(bounds)).toBe(true);
      resume();
      await admission;
      expect(owners.snapshot().liveRows).toBe(0);
    } finally {
      resume();
      await admission.catch(() => {});
      await cleanup();
    }
  }, 120_000);
});

describe('streamed deferred media ownership', () => {
  it('keeps media usable after startup failure, transfers on retry, and releases on disposal', async () => {
    const { client, config, store, cleanup } = await buildDeferredClient();
    async function* source(): AsyncIterable<IContent> {
      yield {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          },
        ],
      };
    }
    try {
      await client.storeHistoryForLaterUse(source());
      const cursor = client.streamHistory();
      const row = await nextContent(cursor);
      await cursor.return();
      const reference = row.blocks[0];
      if (reference.type !== 'media' || reference.encoding !== 'reference')
        throw new Error('Expected admitted media');
      expect(await store.hasReservations(reference.contentId)).toBe(true);
      config.setTokenizerFactory(
        accountingFactory(() => {
          throw new Error('startup token failure');
        }),
      );
      await expect(client.startChat([])).rejects.toThrow(
        'startup token failure',
      );
      expect(await store.hasReservations(reference.contentId)).toBe(true);
      expect(client.hasChatInitialized()).toBe(false);
      config.setTokenizerFactory(accountingFactory((text) => text.length));
      await client.startChat([]);
      expect(await store.hasReservations(reference.contentId)).toBe(true);
      await client.dispose();
      expect(await store.hasReservations(reference.contentId)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

describe('deferred disk commit acknowledgement', () => {
  it('does not complete or expose admission before the final durable write acknowledgement and rolls back write failure', async () => {
    const { client, cleanup } = await buildDeferredClient();
    async function* source(text: string): AsyncIterable<IContent> {
      yield { speaker: 'human', blocks: [{ type: 'text', text }] };
    }
    await client.storeHistoryForLaterUse(source('previous row'));
    let release: () => void = () => {};
    let reached: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let fail = false;
    let armed = false;
    let paused = false;
    // Mutations await durability through waitForCommitSequence. Pause only the
    // first acknowledgement after arming so reads made while paused still pass.
    const wait = SessionRecordingService.prototype.waitForCommitSequence;
    const acknowledgement = vi
      .spyOn(SessionRecordingService.prototype, 'waitForCommitSequence')
      .mockImplementation(async function (
        this: SessionRecordingService,
        ...args
      ) {
        const committed = await wait.call(this, ...args);
        if (armed && !paused) {
          if (fail) throw new Error('final write acknowledgement failed');
          paused = true;
          reached();
          await gate;
        }
        return committed;
      });
    let completed = false;
    armed = true;
    const admission = client
      .storeHistoryForLaterUse(source('durable row'))
      .then(() => {
        completed = true;
      });
    try {
      await entered;
      expect(completed).toBe(false);
      expect(
        (await Array.fromAsync(client.getHistory())).map((row) => row.blocks),
      ).toStrictEqual([[{ type: 'text', text: 'previous row' }]]);
      release();
      await admission;
      expect(completed).toBe(true);
      const history = client.getHistoryService();
      if (history === null) throw new Error('Missing admitted journal');
      expect(history.getContextRange().totalEntries).toBe(1);
      paused = false;
      fail = true;
      await expect(
        client.storeHistoryForLaterUse(source('durable row')),
      ).rejects.toThrow('final write acknowledgement failed');
      expect(history.getTotalTokens()).toBe('durable row'.length);
      expect(
        (await Array.fromAsync(client.getHistory())).map((row) => row.blocks),
      ).toStrictEqual([[{ type: 'text', text: 'durable row' }]]);
    } finally {
      release();
      await admission.catch(() => {});
      acknowledgement.mockRestore();
      await cleanup();
    }
  });
});
