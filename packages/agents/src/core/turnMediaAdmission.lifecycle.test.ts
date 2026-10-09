/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { collectRowsForAssertions as withRows } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatSession } from './chatSession.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { resetCliRuntimeRegistryForTesting } from '@vybestack/llxprt-code-providers/runtime/runtimeRegistry.js';
import { collectHistoryFixture } from './__tests__/support/collect-history-test-fixture.js';

const INPUT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const OUTPUT_JPEG =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

type ProviderBehavior =
  | 'success'
  | 'reject'
  | 'abort'
  | 'stream-failure'
  | 'invalid-stream'
  | 'retry-success';

interface TurnMediaFixture {
  readonly chat: ChatSession;
  readonly store: LocalMediaStore;
  readonly rootDirectory: string;
  readonly providerStarted: Promise<void>;
  readonly recording: SessionRecordingService | undefined;
}

class ReleaseReportingStore extends LocalMediaStore {
  override async release(contentId: string, ownerId: string): Promise<void> {
    await super.release(contentId, ownerId);
    throw new Error('induced media cleanup failure');
  }
}

function errorMessages(error: unknown): readonly string[] {
  if (!(error instanceof Error)) return [];
  const nested =
    error instanceof AggregateError
      ? error.errors.flatMap((entry) => errorMessages(entry))
      : [];
  return [error.message, ...nested];
}

function inlineMediaContent(data: string, mimeType: string): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'inspect this image' },
      { type: 'media', mimeType, encoding: 'base64', data },
    ],
  };
}

function providerOutput(options: {
  readonly includeText: boolean;
  readonly finish: boolean;
}): IContent {
  return {
    speaker: 'ai',
    blocks: [
      ...(options.includeText
        ? [{ type: 'text' as const, text: 'completed' }]
        : []),
      {
        type: 'media',
        mimeType: 'image/jpeg',
        encoding: 'base64',
        data: OUTPUT_JPEG,
      },
    ],
    ...(options.finish
      ? { metadata: { finishReason: 'stop' as const, rawStopReason: 'STOP' } }
      : {}),
  };
}

function abortError(): Error {
  const error = new Error('turn aborted');
  error.name = 'AbortError';
  return error;
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) {
    return Promise.reject(new Error('Expected provider abort signal'));
  }
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), {
      once: true,
    });
  });
}

function requestAbortSignal(
  request: GenerateChatOptions | AsyncIterable<IContent>,
): AbortSignal | undefined {
  if (Symbol.asyncIterator in request) return undefined;
  const signal = request.metadata?.abortSignal;
  return signal instanceof AbortSignal ? signal : undefined;
}

async function countFiles(directory: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return 0;
    }
    throw error;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFiles(join(directory, entry.name));
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function reservationOwnerCount(rootDirectory: string): Promise<number> {
  return countFiles(join(rootDirectory, 'references', 'sha256'));
}

function mediaReferences(history: readonly IContent[]): MediaReferenceBlock[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'media' && block.encoding === 'reference' ? [block] : [],
    ),
  );
}

function createFixtureProvider(behavior: ProviderBehavior): {
  readonly provider: IProvider;
  readonly providerStarted: Promise<void>;
} {
  let markProviderStarted = (): void => undefined;
  const providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve;
  });
  let providerAttempt = 0;
  const provider: IProvider = {
    name: `turn-media-${behavior}`,
    getDefaultModel: () => 'turn-media-model',
    getModels: () => Promise.resolve([]),
    generateChatCompletion(
      request: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      return (async function* (): AsyncIterableIterator<IContent> {
        markProviderStarted();
        providerAttempt += 1;
        if (behavior === 'reject') throw new Error('provider rejected turn');
        if (behavior === 'abort') {
          yield* [];
          await waitForAbort(requestAbortSignal(request));
        }
        if (behavior === 'stream-failure') {
          yield providerOutput({ includeText: true, finish: false });
          throw new Error('provider stream failed');
        }
        if (behavior === 'invalid-stream') {
          yield providerOutput({ includeText: false, finish: false });
          return;
        }
        if (behavior === 'retry-success' && providerAttempt === 1) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: INPUT_PNG,
              },
            ],
          };
          return;
        }
        yield providerOutput({ includeText: true, finish: true });
      })();
    },
  };
  return { provider, providerStarted };
}

function createFixtureContentGenerator(): ConstructorParameters<
  typeof ChatSession
>[1] {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(1),
    embedContent: vi.fn(),
  };
}

async function createFixture(
  directory: string,
  behavior: ProviderBehavior,
  options: {
    readonly purgeFailure?: boolean;
    readonly releaseFailure?: boolean;
  } = {},
): Promise<TurnMediaFixture> {
  const { provider, providerStarted } = createFixtureProvider(behavior);
  const recording =
    options.purgeFailure === true
      ? new SessionRecordingService({
          sessionId: `turn-media-${behavior}`,
          projectHash: 'turn-media-project',
          chatsDir: join(directory, 'chats'),
          workspaceDirs: [],
          provider: provider.name,
          model: 'turn-media-model',
        })
      : undefined;
  if (recording !== undefined) {
    recording.recordSemanticMediaPurgeRows = async () => {
      throw new Error('semantic purge persistence failed');
    };
  }
  const setup = createChatSessionRuntime({
    provider,
    ...(recording === undefined
      ? {}
      : {
          configOverrides: {
            getSessionRecordingService: () => recording,
          },
        }),
  });
  if (recording !== undefined) {
    setup.settingsService.set('media.semantic-purge', 'remove');
  }
  const rootDirectory = join(directory, `media-${behavior}`);
  const Store =
    options.releaseFailure === true ? ReleaseReportingStore : LocalMediaStore;
  const store = new Store({
    rootDirectory,
    quotaBytes: 1024 * 1024,
  });
  const history = new HistoryService();
  const runtime = createAgentRuntimeContext({
    state: createAgentRuntimeState({
      runtimeId: `turn-media-${behavior}`,
      provider: provider.name,
      model: 'turn-media-model',
      sessionId: `turn-media-${behavior}`,
    }),
    history,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 100_000,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      'media.semantic-purge': recording === undefined ? 'off' : 'remove',
    },
    provider: createProviderAdapterFromManager(
      setup.config.getProviderManager(),
    ),
    telemetry: createTelemetryAdapterFromConfig(setup.config),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: { ...setup.runtime, config: setup.config },
    mediaStore: store,
    mediaAdmission: new MediaAdmissionService(store),
  });
  const contentGenerator = createFixtureContentGenerator();
  return {
    chat: new ChatSession(runtime, contentGenerator, {}, []),
    store,
    rootDirectory,
    providerStarted,
    recording,
  };
}

async function assertReleasedToBaseline(
  fixture: TurnMediaFixture,
  baselineOwners: number,
  protectedContentIds: ReadonlySet<string> = new Set(),
  expectedReclaimedObjects = 1,
): Promise<void> {
  const owners = await reservationOwnerCount(fixture.rootDirectory);
  const reclamation = await fixture.store.reclaimUnreferenced(
    protectedContentIds,
    Date.now(),
  );
  expect({ owners, reclaimed: reclamation.objectsRemoved }).toStrictEqual({
    owners: baselineOwners,
    reclaimed: expectedReclaimedObjects,
  });
}

function registerMediaCase0(directory: () => string): void {
  describe('releases admitted user media when the provider rejects a non-streaming turn', () => {
    it('releases admitted user media when the provider rejects a non-streaming turn', async () => {
      const fixture = await createFixture(directory(), 'reject');
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);

      await expect(
        fixture.chat.sendMessage(
          { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
          'provider-rejection',
        ),
      ).rejects.toThrow('provider rejected turn');

      await assertReleasedToBaseline(fixture, baselineOwners);
    });
  });
}

function registerMediaCase1(directory: () => string): void {
  describe('aggregates provider rejection with awaited media cleanup failure', () => {
    it('aggregates provider rejection with awaited media cleanup failure', async () => {
      const fixture = await createFixture(directory(), 'reject', {
        releaseFailure: true,
      });
      let failure: unknown;

      try {
        await fixture.chat.sendMessage(
          { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
          'provider-and-cleanup-rejection',
        );
      } catch (error: unknown) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(AggregateError);
      expect(errorMessages(failure)).toStrictEqual(
        expect.arrayContaining([
          'provider rejected turn',
          'induced media cleanup failure',
        ]),
      );
      expect(await reservationOwnerCount(fixture.rootDirectory)).toBe(0);
    });
  });
}

function registerMediaCase2(directory: () => string): void {
  describe('rolls back published history when temporary media settlement fails', () => {
    it('rolls back published history when temporary media settlement fails', async () => {
      const fixture = await createFixture(directory(), 'success', {
        releaseFailure: true,
      });
      let failure: unknown;

      try {
        await fixture.chat.sendMessage(
          { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
          'publication-cleanup-rejection',
        );
      } catch (error: unknown) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(AggregateError);
      expect(errorMessages(failure)).toContain('induced media cleanup failure');
      await withRows(
        fixture.chat.getHistoryService().streamRawHistory(),
        async (rows) => {
          expect(rows).toStrictEqual([]);
          expect(await reservationOwnerCount(fixture.rootDirectory)).toBe(0);
        },
      );
    });
  });
}

function registerMediaCase3(directory: () => string): void {
  describe('awaits admitted user-media release when a non-streaming turn is aborted', () => {
    it('awaits admitted user-media release when a non-streaming turn is aborted', async () => {
      const fixture = await createFixture(directory(), 'abort');
      const controller = new AbortController();
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);
      const sending = fixture.chat.sendMessage(
        {
          message: [inlineMediaContent(INPUT_PNG, 'image/png')],
          config: { abortSignal: controller.signal },
        },
        'aborted-turn',
      );
      await fixture.providerStarted;

      controller.abort();
      await expect(sending).rejects.toThrow(/abort/i);

      await assertReleasedToBaseline(fixture, baselineOwners);
    });
  });
}

function registerMediaCase4(directory: () => string): void {
  describe('releases superseded stream output and retained user media after retry exhaustion', () => {
    it('releases superseded stream output and retained user media after retry exhaustion', async () => {
      const fixture = await createFixture(directory(), 'invalid-stream');
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);

      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'retry-exhaustion',
      );
      await expect(
        (async () => {
          for await (const _event of stream) {
            // Drain through the real retry and finalization paths.
          }
        })(),
      ).rejects.toThrow(/stream ended/i);

      await assertReleasedToBaseline(fixture, baselineOwners, new Set(), 2);
    });
  });
}

function registerMediaCase5(directory: () => string): void {
  describe('retains the user admission while releasing superseded output on a successful retry', () => {
    it('retains the user admission while releasing superseded output on a successful retry', async () => {
      const fixture = await createFixture(directory(), 'retry-success');
      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'retry-success',
      );

      for await (const _event of stream) {
        // Drain both attempts and the successful history commit.
      }

      const references = mediaReferences(
        await collectHistoryFixture(fixture.chat.getHistory()),
      );
      await Promise.all(
        references.map((reference) => fixture.store.readVerified(reference)),
      );
      expect({
        owners: await reservationOwnerCount(fixture.rootDirectory),
        references: references.length,
      }).toStrictEqual({ owners: 2, references: 2 });
    });
  });
}

function registerMediaCase6(directory: () => string): void {
  describe('releases admitted user and output media when a stream consumer cancels', () => {
    it('releases admitted user and output media when a stream consumer cancels', async () => {
      const fixture = await createFixture(directory(), 'success');
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);
      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'stream-cancellation',
      );

      await stream.next();
      await stream.return(undefined);

      const owners = await reservationOwnerCount(fixture.rootDirectory);
      const reclamation = await fixture.store.reclaimUnreferenced(
        new Set(),
        Date.now(),
      );
      expect({ owners, reclaimed: reclamation.objectsRemoved }).toStrictEqual({
        owners: baselineOwners,
        reclaimed: 2,
      });
    });
  });
}

function registerMediaCase7(directory: () => string): void {
  describe('releases admitted user media when a stream is cancelled before consumption', () => {
    it('releases admitted user media when a stream is cancelled before consumption', async () => {
      const fixture = await createFixture(directory(), 'success');
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);
      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'stream-pre-consumption-cancellation',
      );

      await stream.return(undefined);

      await assertReleasedToBaseline(fixture, baselineOwners);
      expect(await reservationOwnerCount(fixture.rootDirectory)).toBe(0);
    });
  });
}

function registerMediaCase8(directory: () => string): void {
  describe('releases admitted user media when an unstarted stream receives a thrown cancellation', () => {
    it('releases admitted user media when an unstarted stream receives a thrown cancellation', async () => {
      const fixture = await createFixture(directory(), 'success');
      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'stream-thrown-cancellation',
      );

      await expect(
        stream.throw(new Error('caller cancelled stream')),
      ).rejects.toThrow('caller cancelled stream');

      const reclamation = await fixture.store.reclaimUnreferenced(
        new Set(),
        Date.now(),
      );
      expect({
        owners: await reservationOwnerCount(fixture.rootDirectory),
        reclaimed: reclamation.objectsRemoved,
      }).toStrictEqual({ owners: 0, reclaimed: 1 });
    });
  });
}

function registerMediaCase9(directory: () => string): void {
  describe('releases admitted user and output media when a provider stream fails', () => {
    it('releases admitted user and output media when a provider stream fails', async () => {
      const fixture = await createFixture(directory(), 'stream-failure');
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);

      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'stream-failure',
      );
      await expect(
        (async () => {
          for await (const _event of stream) {
            // Drain until the provider failure crosses the real stream processor.
          }
        })(),
      ).rejects.toThrow('provider stream failed');

      const owners = await reservationOwnerCount(fixture.rootDirectory);
      const reclamation = await fixture.store.reclaimUnreferenced(
        new Set(),
        Date.now(),
      );
      expect({ owners, reclaimed: reclamation.objectsRemoved }).toStrictEqual({
        owners: baselineOwners,
        reclaimed: 2,
      });
    });
  });
}

function registerMediaCase10(directory: () => string): void {
  describe('releases admitted user media when semantic-purge persistence rejects', () => {
    it('releases admitted user media when semantic-purge persistence rejects', async () => {
      const fixture = await createFixture(directory(), 'success', {
        purgeFailure: true,
      });
      await fixture.chat.setHistory([
        inlineMediaContent(OUTPUT_JPEG, 'image/jpeg'),
      ]);
      const retainedIds = new Set(
        mediaReferences(
          await collectHistoryFixture(fixture.chat.getHistory()),
        ).map((block) => block.contentId),
      );
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);

      await expect(
        fixture.chat.sendMessage(
          { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
          'purge-failure',
        ),
      ).rejects.toThrow('semantic purge persistence failed');

      await assertReleasedToBaseline(fixture, baselineOwners, retainedIds);
      await fixture.recording?.dispose();
    });
  });
}

function registerMediaCase11(directory: () => string): void {
  describe('releases admitted user and output media when history commit rejects', () => {
    it('releases admitted user and output media when history commit rejects', async () => {
      const fixture = await createFixture(directory(), 'success');
      fixture.chat.getHistoryService().on('contentBatchAdded', () => {
        throw new Error('history commit rejected');
      });
      const baselineOwners = await reservationOwnerCount(fixture.rootDirectory);

      await expect(
        fixture.chat.sendMessage(
          { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
          'history-rejection',
        ),
      ).rejects.toThrow('history commit rejected');

      const owners = await reservationOwnerCount(fixture.rootDirectory);
      const reclamation = await fixture.store.reclaimUnreferenced(
        new Set(),
        Date.now(),
      );
      expect({
        owners,
        reclaimed: reclamation.objectsRemoved,
        historyEntries: (await collectHistoryFixture(fixture.chat.getHistory()))
          .length,
      }).toStrictEqual({
        owners: baselineOwners,
        reclaimed: 2,
        historyEntries: 0,
      });
    });
  });
}

function registerMediaCase12(directory: () => string): void {
  describe('rolls back streaming history before releasing rejected turn admissions', () => {
    it('rolls back streaming history before releasing rejected turn admissions', async () => {
      const fixture = await createFixture(directory(), 'success');
      fixture.chat.getHistoryService().on('contentBatchAdded', () => {
        throw new Error('stream history commit rejected');
      });
      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'stream-history-rejection',
      );

      await expect(
        (async () => {
          for await (const _event of stream) {
            // Drain through stream history finalization.
          }
        })(),
      ).rejects.toThrow('stream history commit rejected');

      const reclamation = await fixture.store.reclaimUnreferenced(
        new Set(),
        Date.now(),
      );
      expect({
        owners: await reservationOwnerCount(fixture.rootDirectory),
        reclaimed: reclamation.objectsRemoved,
        historyEntries: (await collectHistoryFixture(fixture.chat.getHistory()))
          .length,
      }).toStrictEqual({ owners: 0, reclaimed: 2, historyEntries: 0 });
    });
  });
}

function registerMediaCase13(directory: () => string): void {
  describe('transfers non-streaming user and output admissions once history commits', () => {
    it('transfers non-streaming user and output admissions once history commits', async () => {
      const fixture = await createFixture(directory(), 'success');

      await fixture.chat.sendMessage(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },

        'non-stream-success',
      );

      const references = mediaReferences(
        await collectHistoryFixture(fixture.chat.getHistory()),
      );
      const resolved = await Promise.all(
        references.map((reference) => fixture.store.readVerified(reference)),
      );
      const reclamation = await fixture.store.reclaimUnreferenced(
        new Set(),
        Date.now(),
      );
      expect({
        owners: await reservationOwnerCount(fixture.rootDirectory),
        references: references.length,
        resolvedBytes: resolved.map((bytes) => bytes.byteLength),
        reclaimed: reclamation.objectsRemoved,
      }).toStrictEqual({
        owners: 2,
        references: 2,
        resolvedBytes: [68, 287],
        reclaimed: 0,
      });
    });
  });
}

function registerMediaCase14(directory: () => string): void {
  describe('transfers streaming user and output admissions once final history commits', () => {
    it('transfers streaming user and output admissions once final history commits', async () => {
      const fixture = await createFixture(directory(), 'success');
      const stream = await fixture.chat.sendMessageStream(
        { message: [inlineMediaContent(INPUT_PNG, 'image/png')] },
        'stream-success',
      );

      for await (const _event of stream) {
        // Drain through stream finalization and history commit.
      }

      const references = mediaReferences(
        await collectHistoryFixture(fixture.chat.getHistory()),
      );
      const resolved = await Promise.all(
        references.map((reference) => fixture.store.readVerified(reference)),
      );
      const reclamation = await fixture.store.reclaimUnreferenced(
        new Set(),
        Date.now(),
      );
      expect({
        owners: await reservationOwnerCount(fixture.rootDirectory),
        references: references.length,
        resolvedBytes: resolved.map((bytes) => bytes.byteLength),
        reclaimed: reclamation.objectsRemoved,
      }).toStrictEqual({
        owners: 2,
        references: 2,
        resolvedBytes: [68, 287],
        reclaimed: 0,
      });
    });
  });
}

describe('turn media admission terminal lifecycle', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-turn-media-lifecycle-'));
  });
  afterEach(async () => {
    resetCliRuntimeRegistryForTesting();
    await rm(directory, { recursive: true, force: true });
  });
  registerMediaCase0(() => directory);
  registerMediaCase1(() => directory);
  registerMediaCase2(() => directory);
  registerMediaCase3(() => directory);
  registerMediaCase4(() => directory);
  registerMediaCase5(() => directory);
  registerMediaCase6(() => directory);
  registerMediaCase7(() => directory);
  registerMediaCase8(() => directory);
  registerMediaCase9(() => directory);
  registerMediaCase10(() => directory);
  registerMediaCase11(() => directory);
  registerMediaCase12(() => directory);
  registerMediaCase13(() => directory);
  registerMediaCase14(() => directory);
});
