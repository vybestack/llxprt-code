/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  spyOn,
} from 'bun:test';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { collectHistoryFixture } from './__tests__/support/collect-history-test-fixture.js';
import {
  mediaHistory,
  mediaHistoryShape,
  prefixedMediaHistory,
} from './chatSession.media-history-fixtures.js';
import {
  closeMediaHistoryHarness,
  createChat,
  createPurgeChat,
  findReferenceMedia,
  harnessDirectory,
  harnessLifecycle,
  openMediaHistoryHarness,
  rawRows,
  sendOwned,
  streamOwned,
} from './__tests__/support/chatSession.media-history-harness.js';
const priorTokenLimits = {
  ...(await import('@vybestack/llxprt-code-core/core/tokenLimits.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => ({
  ...priorTokenLimits,
  tokenLimit: (model: string, userLimit?: number) =>
    userLimit ?? priorTokenLimits.tokenLimit(model),
}));
function mediaEncodings(history: readonly IContent[]): readonly string[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'media' ? [block.encoding] : [],
    ),
  );
}

describe('ChatSession media history boundaries', () => {
  beforeEach(openMediaHistoryHarness);
  afterEach(closeMediaHistoryHarness);
  afterAll(() => {
    void vi.mock(
      '@vybestack/llxprt-code-core/core/tokenLimits.js',
      () => priorTokenLimits,
    );
  });
  it(
    'rebinds prepared chat history without recreating media admission and retires the old graph separately',
    testMediaHistory17,
  );
  it(
    'migrates inline local media before setHistory retains it and leaves URLs unchanged',
    testMediaHistory1,
  );
  it(
    'awaits session-scoped provider-file deletion before history cleanup completes',
    testMediaHistory2,
  );
  it(
    'keeps local history when provider-file deletion fails',
    testMediaHistory3,
  );
  it(
    'leaves retained history unchanged when setHistory admission fails',
    testMediaHistory4,
  );
  it(
    'commits semantic media purge to the adopted live history after rebinding',
    testMediaHistory18,
  );
  it(
    'rejects an ownerless semantic purge without changing durable history',
    testMediaHistory19,
  );
  it(
    'sends the purge candidate through the real chat send path and commits after provider success',
    testMediaHistory5,
  );
  it(
    'keeps the default-off request unchanged and creates no purge recording event',
    testMediaHistory6,
  );
  it(
    'requires cache-write proof from explicit capabilities rather than provider name',
    testMediaHistory7,
  );
  it(
    'does not infer explicit cache behavior from an Anthropic-shaped name',
    testMediaHistory8,
  );
  it(
    'keeps the purge image in the explicit-cache streaming request',
    testMediaHistory9,
  );
  it(
    'rolls back Anthropic purge without observed cache-write usage',
    testMediaHistory10,
  );
  it(
    'commits Anthropic purge from exact boundary evidence and observed cache-write usage',
    testMediaHistory11,
  );
  it('does not purge when provider completion fails', testMediaHistory12);
  it(
    'rolls back a committed non-streaming purge when successful-turn history commit fails',
    testMediaHistory13,
  );
  it(
    'rolls back a committed streaming purge when successful-turn history commit fails',
    testMediaHistory14,
  );
  it(
    'does not commit a non-streaming turn when semantic-purge persistence fails first',
    testMediaHistory15,
  );
  it(
    'begins each concurrent semantic purge after the previous send commits',
    testMediaHistory16,
  );
});

async function testMediaHistory1(): Promise<void> {
  const chat = await createChat();
  const input = mediaHistory();

  await chat.setHistory(input);

  const stored = await collectHistoryFixture(chat.getHistory());
  const local = stored[0]?.blocks[0];
  if (local.type !== 'media') throw new Error('Expected local media block');
  expect(local.encoding).toBe('reference');
  expect(stored[0]?.blocks[1]).toStrictEqual(input[0]?.blocks[1]);
}

async function testMediaHistory2(): Promise<void> {
  const chat = await createChat();
  let finishDeletion = (): void => {
    throw new Error('Provider-file deletion did not initialize');
  };
  const deletionBlocked = new Promise<void>((resolve) => {
    finishDeletion = resolve;
  });
  const retained = await harnessLifecycle().retain({
    cacheKey: 'chat-clear-provider-file',
    fileId: 'provider-file-for-chat-clear',
    bytes: 1,
    identity: {
      provider: 'test-provider',
      baseURL: 'https://provider.test/v1',
      credentialHash: 'chat-clear-credential',
    },
    policy: {
      mode: 'enabled',
      scope: 'session',
      retentionMs: 60_000,
      deletion: 'delete',
      zeroDataRetention: 'incompatible-while-retained',
    },
    scopeId: 'media-history-runtime',
    deleteRemote: () => deletionBlocked,
  });
  await retained.lease.release();

  const clearing: unknown = chat.clearHistory();
  if (!(clearing instanceof Promise)) {
    finishDeletion();
    throw new Error('Expected clearHistory to return its cleanup promise');
  }
  const pendingOutcome = await Promise.race([
    clearing.then(() => 'cleared'),
    Promise.resolve('pending'),
  ]);
  expect(pendingOutcome).toBe('pending');

  finishDeletion();
  await clearing;
  expect(
    harnessLifecycle().acquire({
      cacheKey: 'chat-clear-provider-file',
      identity: {
        provider: 'test-provider',
        baseURL: 'https://provider.test/v1',
        credentialHash: 'chat-clear-credential',
      },
      scope: 'session',
      scopeId: 'media-history-runtime',
    }),
  ).toBeUndefined();
}

async function testMediaHistory3(): Promise<void> {
  const chat = await createChat();
  await chat.setHistory([
    { speaker: 'human', blocks: [{ type: 'text', text: 'retained' }] },
  ]);
  const retained = await harnessLifecycle().retain({
    cacheKey: 'chat-clear-provider-file-failure',
    fileId: 'provider-file-for-chat-clear-failure',
    bytes: 1,
    identity: {
      provider: 'test-provider',
      baseURL: 'https://provider.test/v1',
      credentialHash: 'chat-clear-failure-credential',
    },
    policy: {
      mode: 'enabled',
      scope: 'session',
      retentionMs: 60_000,
      deletion: 'delete',
      zeroDataRetention: 'incompatible-while-retained',
    },
    scopeId: 'media-history-runtime',
    deleteRemote: () => Promise.reject(new Error('provider deletion failed')),
  });
  await retained.lease.release();

  await expect(chat.clearHistory()).rejects.toThrow(
    /provider file cleanup incomplete/i,
  );

  expect(
    (await collectHistoryFixture(chat.getHistory()))[0]?.blocks,
  ).toStrictEqual([{ type: 'text', text: 'retained' }]);
}

async function testMediaHistory4(): Promise<void> {
  const chat = await createChat();
  await chat.setHistory([
    { speaker: 'human', blocks: [{ type: 'text', text: 'retained' }] },
  ]);

  await expect(
    Promise.resolve(chat.setHistory(mediaHistory('not-base64'))),
  ).rejects.toThrow(/media admission failed/i);

  expect(
    (await collectHistoryFixture(chat.getHistory()))[0]?.blocks,
  ).toStrictEqual([{ type: 'text', text: 'retained' }]);
}

async function testMediaHistory5(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'test-provider',
  });
  await fixture.chat.setHistory(mediaHistory());

  await sendOwned(fixture, 'next', 'purge-success');
  await fixture.recording.flush();

  const firstRequestBlocks = fixture.requests[0]?.[0]?.blocks;
  expect(firstRequestBlocks).toStrictEqual([
    {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'url',
      data: 'https://example.test/image.png',
    },
  ]);
  expect(
    (await collectHistoryFixture(fixture.chat.getHistory()))[0]?.blocks,
  ).toStrictEqual(firstRequestBlocks);
  await fixture.recording.dispose();
}

async function testMediaHistory6(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'off',
    providerName: 'test-provider-off',
  });
  await fixture.chat.setHistory(mediaHistory());
  const before = await collectHistoryFixture(fixture.chat.getHistory());

  await fixture.chat.sendMessage({ message: 'next' }, 'purge-off');
  await fixture.recording.flush();

  expect(fixture.requests[0]?.slice(0, before.length)).toStrictEqual([
    ...before,
  ]);
  expect(
    (await collectHistoryFixture(fixture.chat.getHistory()))[0]?.blocks,
  ).toStrictEqual(before[0]?.blocks);
  expect(fixture.recording.getFilePath()).toBeNull();
  await fixture.recording.dispose();
}

async function testMediaHistory7(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'custom-explicit-cache-provider',
    explicitCacheBreakpoints: true,
    cacheWriteTokens: 0,
  });
  await fixture.chat.setHistory(mediaHistory());

  await sendOwned(fixture, 'next', 'capability-cache-proof');

  expect(
    fixture.requests[0]?.[0]?.blocks.map((block) =>
      block.type === 'media' ? block.encoding : block.type,
    ),
  ).toStrictEqual(['reference', 'url']);
  expect(
    (await collectHistoryFixture(fixture.chat.getHistory()))[0]?.blocks.map(
      (block) => (block.type === 'media' ? block.encoding : block.type),
    ),
  ).toStrictEqual(['reference', 'url']);
  await fixture.recording.dispose();
}

async function testMediaHistory8(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'anthropic',
    explicitCacheBreakpoints: false,
    cacheWriteTokens: 0,
  });
  await fixture.chat.setHistory(mediaHistory());

  await sendOwned(fixture, 'next', 'capability-no-cache-proof');

  expect(
    fixture.requests[0]?.[0]?.blocks.map((block) =>
      block.type === 'media' ? block.encoding : block.type,
    ),
  ).toStrictEqual(['url']);
  expect(
    (await collectHistoryFixture(fixture.chat.getHistory()))[0]?.blocks.map(
      (block) => (block.type === 'media' ? block.encoding : block.type),
    ),
  ).toStrictEqual(['url']);
  await fixture.recording.dispose();
}

async function testMediaHistory9(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'anthropic',
    explicitCacheBreakpoints: true,
    cacheWriteTokens: 0,
  });
  await fixture.chat.setHistory(mediaHistory());

  const stream = await streamOwned(
    fixture,
    'next',
    'purge-stream-request-history',
  );
  for await (const _event of stream) {
    // Consume the real stream so finalization and purge evidence run.
  }

  expect(
    fixture.requests[0]?.[0]?.blocks.map((block) =>
      block.type === 'media' ? block.encoding : block.type,
    ),
  ).toStrictEqual(['reference', 'url']);
  await fixture.recording.dispose();
}

async function testMediaHistory10(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'anthropic',
    explicitCacheBreakpoints: true,
    cacheWriteTokens: 0,
  });
  await fixture.chat.setHistory(mediaHistory());

  await sendOwned(fixture, 'next', 'purge-no-cache-write');

  expect(
    (await collectHistoryFixture(fixture.chat.getHistory()))[0]?.blocks.map(
      (block) => (block.type === 'media' ? block.encoding : block.type),
    ),
  ).toStrictEqual(['reference', 'url']);
  await fixture.recording.dispose();
}

async function testMediaHistory11(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'anthropic',
    explicitCacheBreakpoints: true,
    cacheWriteTokens: 9,
  });
  await fixture.chat.setHistory(prefixedMediaHistory());

  await sendOwned(fixture, 'next', 'purge-cache-write');

  expect(
    (await collectHistoryFixture(fixture.chat.getHistory()))[0]?.blocks,
  ).toStrictEqual([
    { type: 'text', text: 'stable prefix' },
    {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'url',
      data: 'https://example.test/image.png',
    },
  ]);
  expect(fixture.recording.getFilePath()).not.toBeNull();
  await fixture.recording.dispose();
}

async function testMediaHistory12(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'test-provider-error',
    fail: true,
  });
  await fixture.chat.setHistory(mediaHistory());

  await expect(sendOwned(fixture, 'next', 'purge-error')).rejects.toThrow(
    'provider failed',
  );

  expect(
    (await collectHistoryFixture(fixture.chat.getHistory()))[0]?.blocks.map(
      (block) => (block.type === 'media' ? block.encoding : block.type),
    ),
  ).toStrictEqual(['reference', 'url']);
  await fixture.recording.dispose();
}

async function testMediaHistory13(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'purge-before-turn-failure',
  });
  await fixture.chat.setHistory(mediaHistory());
  let publications = 0;
  fixture.chat.getHistoryService().on('contentBatchAdded', () => {
    if (++publications === 2) throw new Error('turn history commit failed');
  });

  await expect(
    sendOwned(fixture, 'next', 'turn-commit-failure'),
  ).rejects.toThrow('turn history commit failed');

  expect(
    mediaHistoryShape(await collectHistoryFixture(fixture.chat.getHistory())),
  ).toStrictEqual(['reference', 'url', 'text']);
  await fixture.recording.dispose();
}

async function testMediaHistory14(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'stream-purge-before-turn-failure',
  });
  await fixture.chat.setHistory(mediaHistory());
  let publications = 0;
  fixture.chat.getHistoryService().on('contentBatchAdded', () => {
    if (++publications === 2)
      throw new Error('stream turn history commit failed');
  });

  const stream = await streamOwned(
    fixture,
    'next',
    'stream-turn-commit-failure',
  );
  const consumeStream = async (): Promise<void> => {
    for await (const _event of stream) {
      // Consume the real stream so finalization attempts both commits.
    }
  };
  await expect(consumeStream()).rejects.toThrow(
    'stream turn history commit failed',
  );

  expect(
    mediaHistoryShape(await collectHistoryFixture(fixture.chat.getHistory())),
  ).toStrictEqual(['reference', 'url', 'text']);
  await fixture.recording.dispose();
}

async function testMediaHistory15(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'purge-persistence-failure',
  });
  await fixture.chat.setHistory(mediaHistory());
  const persist = spyOn(
    fixture.execution,
    'persistSemanticMediaPurge',
  ).mockRejectedValue(new Error('purge persistence failed'));

  await expect(
    sendOwned(fixture, 'next', 'purge-commit-failure'),
  ).rejects.toThrow('purge persistence failed');
  persist.mockRestore();

  expect(
    mediaHistoryShape(await collectHistoryFixture(fixture.chat.getHistory())),
  ).toStrictEqual(['reference', 'url', 'text']);
  await fixture.recording.dispose();
}

async function testMediaHistory16(): Promise<void> {
  let releaseFirst: () => void = () => undefined;
  let reportFirstStarted: () => void = () => undefined;
  const firstStarted = new Promise<void>((resolve) => {
    reportFirstStarted = resolve;
  });
  const firstCanComplete = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'concurrent-purge-provider',
    beforeComplete: async (requestIndex) => {
      if (requestIndex !== 0) return;
      reportFirstStarted();
      await firstCanComplete;
    },
  });
  await fixture.chat.setHistory(mediaHistory());

  const first = sendOwned(fixture, 'first', 'purge-first');
  await firstStarted;
  const second = sendOwned(fixture, 'second', 'purge-second');
  releaseFirst();
  await Promise.all([first, second]);

  // Both sends must have reached the transport before their contents mean
  // anything. The `?? []` these replace made the second assertion pass when
  // there was no second request at all: mediaEncodings([]) is [], which is
  // what it asserted (#3129).
  const [firstRequest, secondRequest] = fixture.requests;
  assertDefined(firstRequest, 'first message never reached the transport');
  assertDefined(secondRequest, 'second message never reached the transport');
  expect(mediaEncodings(firstRequest)).toStrictEqual(['url']);
  expect(mediaEncodings(secondRequest)).toStrictEqual([]);
  expect(
    mediaEncodings(await collectHistoryFixture(fixture.chat.getHistory())),
  ).toStrictEqual([]);
  await fixture.recording.dispose();
}

async function testMediaHistory17(): Promise<void> {
  const oldChat = await createChat();
  await oldChat.setHistory(mediaHistory());
  const live = oldChat.getHistoryService();
  const candidate = await createChat(async (request, bindings) => {
    const media = await findReferenceMedia(request.contents);
    if (media !== undefined) {
      if (!bindings) throw new Error('Missing history binding');
      await bindings.bind(media.contentId, {
        provider: 'media-history-provider',
        baseURL: 'https://media.test',
        credentialHash: 'test',
        fileId: 'adopted-file',
        byteLength: media.byteLength,
        scope: 'session',
        scopeId: 'media-history-runtime',
        createdAt: 1,
        expiresAt: 1000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
        deletionState: 'active',
      });
    }
  });
  await candidate.setHistory(
    structuredClone(await collectHistoryFixture(oldChat.getHistory())),
  );
  const detached = candidate.getHistoryService();
  const oldBinding = oldChat.prepareHistoryRebind(detached);
  const newBinding = candidate.prepareHistoryRebind(live, oldChat);
  const adopt = await live.prepareProfileAdoption(detached);
  const before = await rawRows(live);
  const staged = await rawRows(detached);
  expect(await collectHistoryFixture(oldChat.getHistory())).toStrictEqual(
    before,
  );
  oldBinding();
  adopt();
  newBinding();
  await oldChat.clearHistory();
  expect(await collectHistoryFixture(candidate.getHistory())).toStrictEqual(
    staged,
  );
  await candidate.verifyHistoryMedia(
    await collectHistoryFixture(candidate.getHistory()),
  );
  await candidate.sendMessage(
    { message: 'continued after adoption' },
    'adopted-send',
  );
  expect(JSON.stringify(await rawRows(live))).toContain(
    'continued after adoption',
  );
  expect(JSON.stringify(await rawRows(live))).toContain('adopted-file');
  for await (const _event of await candidate.sendMessageStream(
    { message: 'stream after adoption' },
    'adopted-stream',
  )) {
    expect(_event).toBeDefined();
  }
  expect(JSON.stringify(await rawRows(live))).toContain(
    'stream after adoption',
  );
  const beforeDirect = await rawRows(live);
  const direct = await candidate.generateDirectMessage(
    { message: 'direct after adoption' },
    'adopted-direct',
  );
  expect(direct.content.blocks.length).toBeGreaterThan(0);
  expect(await rawRows(live)).toStrictEqual(beforeDirect);
  // The retired chat was rebound to the detached service, and clearing it
  // emptied that service; none of the post-adoption traffic reached it.
  expect(staged).not.toStrictEqual([]);
  expect(await rawRows(detached)).toStrictEqual([]);
  await live.waitForTokenUpdates();
  expect(live.getTotalTokens()).toBeGreaterThan(0);
  const store = new LocalMediaStore({
    rootDirectory: join(harnessDirectory(), 'media'),
    quotaBytes: 1024 * 1024,
  });
  const retained = (await rawRows(live))[0].blocks[0];
  if (retained.type !== 'media' || retained.encoding !== 'reference')
    throw new Error('Expected retained reference');
  expect(await store.hasReservations(retained.contentId)).toBe(true);
  await candidate.clearHistory();
  await live.waitForOwnershipSettlement();
  expect(await rawRows(live)).toStrictEqual([]);
  expect(await store.hasReservations(retained.contentId)).toBe(false);
}

async function testMediaHistory18(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'adopted-purge',
  });
  await fixture.chat.setHistory(mediaHistory());
  const detached = fixture.chat.getHistoryService();
  const staged = await rawRows(detached);
  // The journal facade adopts only a candidate whose journal matches the live
  // one, so the live service is seeded with the same rows before adoption.
  const live = new HistoryService();
  await live.addBatch(structuredClone(staged), 'media-history-model');
  const rebind = fixture.chat.prepareHistoryRebind(live);
  const adopt = await live.prepareProfileAdoption(detached);
  adopt();
  rebind();
  await sendOwned(fixture, 'purge adopted media', 'adopted-purge');
  await fixture.recording.flush();
  const liveRows = await rawRows(live);
  expect(mediaEncodings(liveRows)).toStrictEqual(['url']);
  expect(JSON.stringify(liveRows)).toContain('purge adopted media');
  // The purge must land on the adopted history, not on the detached service.
  expect(await rawRows(detached)).toStrictEqual(staged);
  await fixture.chat.clearHistory();
  await fixture.recording.dispose();
}

async function testMediaHistory19(): Promise<void> {
  const fixture = await createPurgeChat({
    mode: 'remove',
    providerName: 'unbound-purge',
  });
  await fixture.chat.setHistory(mediaHistory());

  await expect(
    fixture.chat.sendMessage({ message: 'next' }, 'unbound-purge'),
  ).rejects.toThrow(
    'Semantic media purge requires an active session recording',
  );

  expect(
    mediaHistoryShape(await collectHistoryFixture(fixture.chat.getHistory())),
  ).toStrictEqual(['reference', 'url', 'text']);
  expect(fixture.requests).toHaveLength(1);
  await fixture.recording.dispose();
}
