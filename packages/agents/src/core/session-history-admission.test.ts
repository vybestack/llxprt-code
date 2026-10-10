/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  MediaAdmissionService,
  type MediaAdmissionContext,
} from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { IProvider } from '@vybestack/llxprt-code-providers/IProvider.js';
import { ChatSession } from './chatSession.js';
import { RetainedHistoryAdmissions } from './retainedHistoryAdmissions.js';
import { collectHistoryFixture } from './__tests__/support/collect-history-test-fixture.js';

const { gcAndSweep }: { gcAndSweep(): void } = createRequire(import.meta.url)(
  'bun:jsc',
);

const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const BLUE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function imageRow(data: string): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'media', mimeType: 'image/png', encoding: 'base64', data },
    ],
  };
}

/** Records every admitted row weakly so tests can prove none is retained. */
class SpyAdmission extends MediaAdmissionService {
  readonly weakAdmitted: Array<WeakRef<object>> = [];
  readonly released: string[] = [];
  admitCalls = 0;
  failAdmitAtCall: number | undefined;
  failRelease = false;
  retainStrongly: object[] | undefined;

  override async admitContents(
    contents: readonly IContent[],
    context: MediaAdmissionContext,
  ): Promise<IContent[]> {
    this.admitCalls += 1;
    if (this.failAdmitAtCall === this.admitCalls)
      throw new Error('admission failed');
    const admitted = await super.admitContents(contents, context);
    this.weakAdmitted.push(new WeakRef(admitted));
    for (const row of admitted) this.weakAdmitted.push(new WeakRef(row));
    this.retainStrongly?.push(admitted);
    return admitted;
  }

  override async releaseReference(
    contentId: string,
    scope?: string,
  ): Promise<void> {
    if (this.failRelease) throw new Error('release failed');
    await super.releaseReference(contentId, scope);
    this.released.push(contentId);
  }
}

let directory = '';
let store: LocalMediaStore;
let admission: SpyAdmission;

function createSession(): ChatSession {
  const provider: IProvider = {
    name: 'session-admission-provider',
    getDefaultModel: () => 'session-admission-model',
    getModels: () => Promise.resolve([]),
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
    },
  };
  const setup = createChatSessionRuntime({ provider });
  store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024 * 1024,
  });
  admission = new SpyAdmission(store);
  const runtime = createAgentRuntimeContext({
    state: createAgentRuntimeState({
      runtimeId: 'session-admission-runtime',
      provider: provider.name,
      model: 'test-model',
      sessionId: 'session-admission-session',
    }),
    history: new HistoryService(),
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 100_000,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
    },
    provider: createProviderAdapterFromManager(
      setup.config.getProviderManager(),
    ),
    telemetry: createTelemetryAdapterFromConfig(setup.config),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: { ...setup.runtime, config: setup.config },
    mediaStore: store,
    mediaAdmission: admission,
  });
  return new ChatSession(
    runtime,
    {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(1),
      embedContent: vi.fn(),
    },
    {},
    [],
  );
}

async function referencedIds(chat: ChatSession): Promise<string[]> {
  const ids: string[] = [];
  for (const row of await collectHistoryFixture(chat.getHistory())) {
    for (const block of row.blocks) {
      if (block.type === 'media' && block.encoding === 'reference')
        ids.push(block.contentId);
    }
  }
  return ids;
}

async function collectGarbage(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await setImmediate();
    gcAndSweep();
  }
}

async function expectNoLive(
  refs: ReadonlyArray<WeakRef<object>>,
): Promise<void> {
  await collectGarbage();
  const live = refs.filter((ref) => ref.deref() !== undefined).length;
  if (live > 0) throw new Error(`${live} admitted objects are still reachable`);
}

async function weakRowsOf(
  rows: AsyncIterable<IContent>,
): Promise<Array<WeakRef<object>>> {
  const weak: Array<WeakRef<object>> = [];
  for await (const row of rows) weak.push(new WeakRef(row));
  return weak;
}

describe('ChatSession.setHistory disk-backed media ownership', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-session-admission-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps media usable after replacement settles and retains no admitted transcript rows', async () => {
    const chat = createSession();
    await chat.setHistory([imageRow(RED_PNG), imageRow(RED_PNG)]);
    const [first] = await referencedIds(chat);
    expect(first).toBeDefined();
    expect(await store.hasReservations(first)).toBe(true);
    expect(admission.weakAdmitted.length).toBeGreaterThan(0);
    await expectNoLive(admission.weakAdmitted);
  });

  it('control: the retention check fails when an admitted array is deliberately retained', async () => {
    const chat = createSession();
    admission.retainStrongly = [];
    await chat.setHistory([imageRow(RED_PNG)]);
    await expect(expectNoLive(admission.weakAdmitted)).rejects.toThrow(
      'still reachable',
    );
  });

  it('releases prior media only after the replacement is published, keeping the new media reserved', async () => {
    const chat = createSession();
    await chat.setHistory([imageRow(RED_PNG)]);
    const [oldId] = await referencedIds(chat);
    await chat.setHistory([imageRow(BLUE_PNG)]);
    const [newId] = await referencedIds(chat);
    expect(newId).not.toBe(oldId);
    expect(admission.released).toStrictEqual([oldId]);
    expect(await store.hasReservations(newId)).toBe(true);
  });

  it('releases each distinct reference once regardless of how many rows reference it', async () => {
    const chat = createSession();
    await chat.setHistory([
      imageRow(RED_PNG),
      imageRow(BLUE_PNG),
      imageRow(RED_PNG),
    ]);
    const ids = await referencedIds(chat);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(2);
    await chat.clearHistory();
    expect([...admission.released].sort()).toStrictEqual(
      [...new Set(ids)].sort(),
    );
  });

  it('releases rows admitted before a mid-stream admission failure and keeps the prior history', async () => {
    const chat = createSession();
    await chat.setHistory([imageRow(RED_PNG)]);
    const [priorId] = await referencedIds(chat);
    admission.failAdmitAtCall = admission.admitCalls + 2;
    await expect(
      chat.setHistory([imageRow(BLUE_PNG), imageRow(BLUE_PNG)]),
    ).rejects.toThrow('admission failed');
    expect(admission.released).toHaveLength(1);
    expect(admission.released[0]).not.toBe(priorId);
    expect(await store.hasReservations(priorId)).toBe(true);
    expect(await referencedIds(chat)).toStrictEqual([priorId]);
  });

  it('reports a failed prior-media release after publishing the replacement', async () => {
    const chat = createSession();
    await chat.setHistory([imageRow(RED_PNG)]);
    admission.failRelease = true;
    await expect(chat.setHistory([imageRow(BLUE_PNG)])).rejects.toThrow(
      'Replaced chat history media cleanup was incomplete',
    );
    expect(await referencedIds(chat)).toHaveLength(1);
  });

  it('clear releases media ownership and a second clear has nothing left to release', async () => {
    const chat = createSession();
    await chat.setHistory([imageRow(RED_PNG)]);
    const [id] = await referencedIds(chat);
    await chat.clearHistory();
    expect(admission.released).toStrictEqual([id]);
    await chat.clearHistory();
    expect(admission.released).toStrictEqual([id]);
  });

  it('surfaces a failed release during clear', async () => {
    const chat = createSession();
    await chat.setHistory([imageRow(RED_PNG)]);
    admission.failRelease = true;
    await expect(chat.clearHistory()).rejects.toThrow(
      'Chat history media cleanup was incomplete',
    );
  });
});

describe('deferred array admission ownership handle', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-session-admission-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('holds only a release handle and retains no admitted rows once consumed', async () => {
    const localStore = new LocalMediaStore({
      rootDirectory: join(directory, 'deferred-media'),
      quotaBytes: 1024 * 1024,
    });
    const admissions = new RetainedHistoryAdmissions(() => localStore);
    const prepared = admissions.prepareDeferredArray(
      [imageRow(RED_PNG), imageRow(BLUE_PNG)],
      {},
    );
    if (prepared.rows === undefined) throw new Error('rows missing');
    const weak = await weakRowsOf(prepared.rows);
    prepared.rows = undefined;
    expect(weak).toHaveLength(2);
    prepared.discardInput();
    expect(Object.keys(prepared.retained)).toStrictEqual(['release']);
    await expectNoLive(weak);
    await prepared.release();
    expect(admissions.all).toHaveLength(0);
  });
});
