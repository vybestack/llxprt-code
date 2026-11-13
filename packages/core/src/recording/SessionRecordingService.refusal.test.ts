/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  withTestNamedWriters,
  testJournalOptions,
} from '../journal/__tests__/support/namedWriterOwner.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { RefusalPayloadSchema, type RefusalPayload } from './refusalPayload.js';
import { textsOf } from './__tests__/refusal-rewrite-test-helpers.js';

const REFUSAL: RefusalPayload = {
  time: '2026-11-11T21:12:00.000Z',
  provider: 'claudecode',
  model: 'claude-opus-5-5',
  promptId: 'prompt-1',
  turnId: 'turn-1',
  attemptIndex: 0,
  finishReason: 'refusal',
  rawStopReason: 'refusal',
  usage: { promptTokens: 120, completionTokens: 0, totalTokens: 120 },
  action: 'stop',
};

describe('refusal journal record', () => {
  const directory = useTempDir('native-recording-refusal-');
  const services: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const service of services.splice(0)) await service.dispose();
  });
  function createService(): JournalRecordingService {
    const service = JournalRecordingService.create(
      withTestNamedWriters({
        sessionId: 'refusal-session-0001',
        projectHash: 'refusal-project',
        chatsDir: directory(),
        workspaceDirs: [],
        provider: 'claudecode',
        model: 'claude-opus-5-5',
      }),
    );
    services.push(service);
    return service;
  }
  async function payload(
    service: JournalRecordingService,
    action = 'stop',
  ): Promise<unknown> {
    const value = await (
      await service.session()
    ).store.getState(`refusal:prompt-1:0:${action}`);
    if (value === undefined) throw new Error('Missing refusal audit');
    return JSON.parse(new TextDecoder().decode(value));
  }
  it('materializes a session whose only event is a refused first request', async () => {
    const service = createService();
    service.recordRefusal(REFUSAL);
    await service.flush();
    expect(service.getFilePath()).not.toBeNull();
    expect(await payload(service)).toStrictEqual(REFUSAL);
  });
  it('writes the refusal payload verbatim', async () => {
    const service = createService();
    service.recordRefusal(REFUSAL);
    await service.flush();
    expect(await payload(service)).toStrictEqual(REFUSAL);
  });
  it('cold opens a refusal-only session with empty history', async () => {
    const service = createService();
    service.recordRefusal(REFUSAL);
    await service.flush();
    const path = service.getFilePath();
    if (path === null) throw new Error('Missing session');
    await service.dispose();
    const session = await JournalSession.open(path, testJournalOptions());
    try {
      expect(await textsOf(contents(session))).toStrictEqual([]);
    } finally {
      await session.close();
    }
  });
  it('leaves surrounding content unchanged through cold reopen', async () => {
    const service = createService();
    const session = await service.session();
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'first question' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'first answer' }] },
    ]);
    service.recordRefusal(REFUSAL);
    await service.flush();
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'second question' }] },
    ]);
    const path = session.path;
    await service.dispose();
    const opened = await JournalSession.open(path, testJournalOptions());
    try {
      expect(await textsOf(contents(opened))).toStrictEqual([
        'first question',
        'first answer',
        'second question',
      ]);
    } finally {
      await opened.close();
    }
  });
  it('keeps the requested backoff through reopen', async () => {
    const service = createService();
    const retry: RefusalPayload = {
      ...REFUSAL,
      action: 'retry',
      delayMs: 15000,
    };
    service.recordRefusal(retry);
    await service.flush();
    const file = service.getFilePath();
    if (file === null) throw new Error('Missing refusal journal');
    await service.dispose();
    const opened = await JournalSession.open(file, testJournalOptions());
    try {
      const bytes = await opened.store.getState('refusal:prompt-1:0:retry');
      if (bytes === undefined) throw new Error('Missing retry audit');
      expect(
        RefusalPayloadSchema.parse(JSON.parse(new TextDecoder().decode(bytes))),
      ).toStrictEqual(retry);
      expect(await textsOf(contents(opened))).toStrictEqual([]);
    } finally {
      await opened.close();
    }
  });
  for (const [label, invalid] of [
    ['negative backoff', { ...REFUSAL, action: 'retry', delayMs: -1 }],
    ['invalid payload', { action: 'explode' }],
  ]) {
    it(`rejects a stored audit with ${label} without changing history`, async () => {
      const service = createService();
      const session = await service.session();
      await session.append([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first question' }],
        },
      ]);
      await session.store.commit([
        {
          kind: 'setState',
          key: 'refusal:prompt-1:0:stop',
          value: new TextEncoder().encode(JSON.stringify(invalid)),
          storage: 'body',
        },
      ]);
      expect(
        RefusalPayloadSchema.safeParse(await payload(service)).success,
      ).toBe(false);
      expect(await textsOf(contents(session))).toStrictEqual([
        'first question',
      ]);
    });
  }
});

async function* contents(session: JournalSession) {
  for await (const row of session.rows()) yield row.content;
}
