/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentClient local-media ownership tests across deferred and active history.
 */

import {
  automock,
  assertDefined,
  assertInstanceOf,
  errorMessage,
} from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { AgentClient } from './client.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { ChatSession } from './chatSession.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import type { IProvider } from '@vybestack/llxprt-code-providers/IProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  setupAgentClient,
  type MockResponseShape,
} from './client-test-helpers.js';

// Mock prompts module before imports
const realConfigModule = {
  ...(await import('@vybestack/llxprt-code-core/config/config.js')),
};

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(() =>
    Promise.resolve('Test system instruction'),
  ),
  getCoreSystemPrompt: vi.fn(() => 'Test system instruction'),
  getCompressionPrompt: vi.fn(() => 'Test compression prompt'),
  initializePromptSystem: vi.fn(() => Promise.resolve(undefined)),
}));

// Mock clientToolGovernance module so tests can control tool name/governance returns
void vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn(() => undefined),
  readToolList: vi.fn((v: unknown) =>
    Array.isArray(v)
      ? (v as unknown[]).filter(
          (e): e is string => typeof e === 'string' && e.trim().length > 0,
        )
      : [],
  ),
  buildToolDeclarationsFromView: vi.fn(() => []),
  getEnabledToolNamesForPrompt: vi.fn(() => []),
  shouldIncludeSubagentDelegationForConfig: vi.fn(() => Promise.resolve(false)),
}));

// --- Mocks (hoisted so vi.mock factories can reference them) ---
const {
  mockChatCreateFn,
  mockGenerateContentFn,
  mockEmbedContentFn,
  mockTurnRunFn,
} = {
  mockChatCreateFn: vi.fn(),
  mockGenerateContentFn: vi.fn(),
  mockEmbedContentFn: vi.fn(),
  mockTurnRunFn: vi.fn(),
};

const {
  todoStoreReadMock,
  todoStoreReadPausedMock,
  todoStoreWritePausedMock,
  mockTodoStoreConstructor,
} = (() => {
  const readMock = vi.fn();
  const readPausedMock = vi.fn();
  const writePausedMock = vi.fn();
  const constructorMock = vi.fn().mockImplementation(() => ({
    readTodos: readMock,
    readPausedState: readPausedMock,
    writePausedState: writePausedMock,
  }));
  return {
    todoStoreReadMock: readMock,
    todoStoreReadPausedMock: readPausedMock,
    todoStoreWritePausedMock: writePausedMock,
    mockTodoStoreConstructor: constructorMock,
  };
})();

void vi.mock(
  '@vybestack/llxprt-code-core/services/complexity-analyzer.js',
  () => ({
    ComplexityAnalyzer: vi.fn().mockImplementation(() => ({
      analyzeComplexity: vi.fn().mockReturnValue({
        complexityScore: 0.2,
        isComplex: false,
        detectedTasks: [],
        sequentialIndicators: [],
        questionCount: 0,
        shouldSuggestTodos: false,
      }),
    })),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/services/todo-reminder-service.js',
  () => ({
    TodoReminderService: vi.fn().mockImplementation(() => ({
      getComplexTaskSuggestion: vi.fn(),
      getEscalatedComplexTaskSuggestion: vi.fn(),
      getCreateListReminder: vi.fn(),
      getUpdateActiveTodoReminder: vi.fn(),
    })),
  }),
);
const actual = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...actual,
  LocalTodoStore: mockTodoStoreConstructor,
}));
const __actual = { ...(await import('./turn.js')) };
void vi.mock('./turn.js', () => {
  const result = __actual as
    | typeof import('./turn.js')
    | Promise<typeof import('./turn.js')>;
  class MockTurn {
    pendingToolCalls: unknown[] = [];
    run = mockTurnRunFn;
    constructor() {}
  }
  if (result instanceof Promise) {
    return result.then((actual) => ({
      ...actual,
      Turn: MockTurn,
    }));
  }
  return {
    ...result,
    Turn: MockTurn,
  };
});

void vi.mock('@vybestack/llxprt-code-core/config/config.js', () =>
  automock(realConfigModule),
);
void vi.mock('@vybestack/llxprt-code-core/utils/getFolderStructure.js', () => ({
  getFolderStructure: vi.fn().mockResolvedValue('Mock Folder Structure'),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));
void vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  () => ({
    getResponseText: (result: MockResponseShape) =>
      result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .join('') ?? undefined,
  }),
);
void vi.mock('@vybestack/llxprt-code-core/telemetry/index.js', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((apiCall) => apiCall()),
}));
const actual3 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => ({
  ...actual3,
  ideContext: {
    ...actual3.ideContext,
    getIdeContext: vi.fn(),
    subscribeToIdeContext: vi.fn(),
    setIdeContext: vi.fn(),
    clearIdeContext: vi.fn(),
  },
}));
const actual4 = {
  ...(await import('@vybestack/llxprt-code-core/core/tokenLimits.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => {
  const tokenLimit = vi.fn();
  return {
    ...actual4,
    tokenLimit,
    resolveEffectiveContextLimit: vi.fn(
      (model: string, userCtx?: number, provCtx?: number) => {
        const ok = (v: unknown): v is number =>
          typeof v === 'number' && Number.isFinite(v) && v > 0;
        if (ok(userCtx)) return userCtx;
        if (ok(provCtx)) return provCtx;
        return tokenLimit(model);
      },
    ),
  };
});
void vi.mock('@vybestack/llxprt-code-core/telemetry/uiTelemetry.js', () => ({
  uiTelemetryService: {
    setLastPromptTokenCount: vi.fn(),
    getLastPromptTokenCount: vi.fn(),
  },
}));

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const SECOND_IMAGE_BASE64 = 'AQIDBAUGBwg=';

function inlineMediaHistory(data: string = PNG_BASE64): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data,
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'url',
          data: 'https://example.test/image.png',
        },
      ],
    },
  ];
}

class FailOnceReleaseStore extends LocalMediaStore {
  private releaseFailurePending = true;

  override async release(contentId: string, ownerId: string): Promise<void> {
    if (this.releaseFailurePending) {
      this.releaseFailurePending = false;
      throw new Error('induced history release failure');
    }
    await super.release(contentId, ownerId);
  }
}

function leafErrorMessages(error: unknown): readonly string[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(leafErrorMessages)
    : [errorMessage(error)];
}

describe('AgentClient (client.ts)', () => {
  let client: AgentClient;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-client-lifecycle-'));
    const ctx = await setupAgentClient({
      mockChatCreateFn,
      mockGenerateContentFn,
      mockEmbedContentFn,
    });
    client = ctx.client;

    mockTodoStoreConstructor.mockImplementation(() => ({
      readTodos: todoStoreReadMock,
      readPausedState: todoStoreReadPausedMock,
      writePausedState: todoStoreWritePausedMock,
    }));
    todoStoreReadMock.mockResolvedValue([]);
    todoStoreReadPausedMock.mockResolvedValue(false);
    todoStoreWritePausedMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await client.dispose();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  function configureMediaStore(quotaBytes = 1024 * 1024): LocalMediaStore {
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes,
    });
    Object.defineProperty(client['config'], 'getLocalMediaStore', {
      configurable: true,
      value: () => store,
    });
    return store;
  }

  function deferredReference(): MediaReferenceBlock {
    const block = client['_previousHistory']?.[0]?.blocks[0];
    if (
      block === undefined ||
      block.type !== 'media' ||
      block.encoding !== 'reference'
    ) {
      throw new Error('Expected deferred media reference');
    }
    return block;
  }

  function configureRealChatStartup(store: LocalMediaStore): ChatSession {
    const initializedChat = client['chat'];
    assertDefined(initializedChat, 'Expected initialized test chat');
    const provider: IProvider = {
      name: 'client-media-provider',
      getDefaultModel: () => 'test-model',
      getModels: () => Promise.resolve([]),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
    };
    const manager = new ProviderManager({
      settingsService: new SettingsService(),
    });
    manager.registerProvider(provider);
    manager.setActiveProvider(provider.name);
    client['config'].getProviderManager = () => manager;
    client['config'].getExcludeTools = () => [];
    Object.defineProperty(client['config'], 'getLocalMediaStore', {
      configurable: true,
      value: () => store,
    });
    return initializedChat;
  }

  describe('history admission lifecycle', () => {
    it('admits local media before retaining history for deferred startup', async () => {
      const store = configureMediaStore();
      client['chat'] = undefined;
      const history = inlineMediaHistory();

      await client.setHistory(history);

      const local = deferredReference();
      expect({
        encoding: local.encoding,
        retainedRawData: JSON.stringify(client['_previousHistory']).includes(
          PNG_BASE64,
        ),
        url: client['_previousHistory']?.[0]?.blocks[1],
        reserved: await store.hasReservations(local.contentId),
      }).toStrictEqual({
        encoding: 'reference',
        retainedRawData: false,
        url: history[0]?.blocks[1],
        reserved: true,
      });
      expect(client['ideContextTracker']['forceFullIdeContext']).toBe(true);
    });

    it('admits deferred history through the awaited storage seam', async () => {
      const store = configureMediaStore();
      client['chat'] = undefined;

      await client.storeHistoryForLaterUse(inlineMediaHistory());

      const reference = deferredReference();
      expect({
        retainedRawData: JSON.stringify(client['_previousHistory']).includes(
          PNG_BASE64,
        ),
        reserved: await store.hasReservations(reference.contentId),
      }).toStrictEqual({ retainedRawData: false, reserved: true });
    });

    it('leaves no retained snapshot when quota rejects deferred admission', async () => {
      const store = configureMediaStore(1);
      client['chat'] = undefined;

      await expect(
        client.storeHistoryForLaterUse(inlineMediaHistory()),
      ).rejects.toThrow(/Media admission failed/);

      expect({
        previousHistory: client['_previousHistory'],
        storedBytes: await store.getStoredByteLength(),
      }).toStrictEqual({ previousHistory: undefined, storedBytes: 0 });
    });

    it('releases deferred media ownership when stored history is replaced or deleted', async () => {
      const store = configureMediaStore();
      client['chat'] = undefined;
      await client.storeHistoryForLaterUse(inlineMediaHistory());
      const first = deferredReference();

      await client.storeHistoryForLaterUse(
        inlineMediaHistory(SECOND_IMAGE_BASE64),
      );
      const second = deferredReference();
      const afterReplacement = {
        first: await store.hasReservations(first.contentId),
        second: await store.hasReservations(second.contentId),
      };

      await client.storeHistoryForLaterUse([]);

      expect({
        afterReplacement,
        afterDeletion: await store.hasReservations(second.contentId),
      }).toStrictEqual({
        afterReplacement: { first: false, second: true },
        afterDeletion: false,
      });
    });

    it('releases deferred ownership on dispose so quota-backed blobs can be reclaimed', async () => {
      const store = configureMediaStore();
      client['chat'] = undefined;
      await client.storeHistoryForLaterUse(inlineMediaHistory());
      const reference = deferredReference();

      await client.dispose();
      const reclaimed = await store.reclaimUnreferenced(
        new Set<string>(),
        Date.now() + 1,
      );

      expect({
        reserved: await store.hasReservations(reference.contentId),
        objectsRemoved: reclaimed.objectsRemoved,
        storedBytes: await store.getStoredByteLength(),
      }).toStrictEqual({
        reserved: false,
        objectsRemoved: 1,
        storedBytes: 0,
      });
    });

    it('transfers deferred media ownership once when real chat startup succeeds', async () => {
      const store = configureMediaStore();
      const initializedChat = configureRealChatStartup(store);
      client['chat'] = undefined;
      await client.storeHistoryForLaterUse(inlineMediaHistory());
      const deferredHistory = client['_previousHistory'];
      assertDefined(deferredHistory, 'Expected deferred history');
      const reference = deferredReference();
      client['chat'] = initializedChat;

      const chat = await client.startChat(deferredHistory);
      const reservedByChat = await store.hasReservations(reference.contentId);
      await chat.clearHistory();

      const firstBlock = deferredHistory[0]?.blocks[0];
      expect({
        encoding: firstBlock.type === 'media' ? firstBlock.encoding : undefined,
        reservedByChat,
        reservedAfterChatCleanup: await store.hasReservations(
          reference.contentId,
        ),
      }).toStrictEqual({
        encoding: 'reference',
        reservedByChat: true,
        reservedAfterChatCleanup: false,
      });
    });

    it('releases deferred ownership when real chat setup fails', async () => {
      const store = configureMediaStore();
      const initializedChat = configureRealChatStartup(store);
      client['chat'] = undefined;
      await client.storeHistoryForLaterUse(inlineMediaHistory());
      const deferredHistory = client['_previousHistory'];
      assertDefined(deferredHistory, 'Expected deferred history');
      const reference = deferredReference();
      client['chat'] = initializedChat;
      client['config'].getModel = () => '';

      await expect(client.startChat(deferredHistory)).rejects.toThrow(
        /no model identity/i,
      );

      expect(await store.hasReservations(reference.contentId)).toBe(false);
    });

    it('aggregates chat setup and deferred ownership cleanup failures', async () => {
      const store = new FailOnceReleaseStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      });
      Object.defineProperty(client['config'], 'getLocalMediaStore', {
        configurable: true,
        value: () => store,
      });
      const initializedChat = configureRealChatStartup(store);
      client['chat'] = undefined;
      await client.storeHistoryForLaterUse(inlineMediaHistory());
      const deferredHistory = client['_previousHistory'];
      assertDefined(deferredHistory, 'Expected deferred history');
      const reference = deferredReference();
      client['chat'] = initializedChat;
      client['config'].getModel = () => '';

      let failure: unknown;
      try {
        await client.startChat(deferredHistory);
      } catch (error: unknown) {
        failure = error;
      }
      assertInstanceOf(
        failure,
        AggregateError,
        'Expected aggregate setup and cleanup failure',
      );
      const messages = failure.errors.flatMap(leafErrorMessages);

      expect({
        messages,
        reservedBeforeRetry: await store.hasReservations(reference.contentId),
      }).toStrictEqual({
        messages: [
          expect.stringContaining('Failed to initialize chat'),
          'induced history release failure',
        ],
        reservedBeforeRetry: true,
      });
      await client.dispose();
      expect(await store.hasReservations(reference.contentId)).toBe(false);
    });

    it('retains the initialized chat snapshot without raw media and releases it on dispose', async () => {
      const store = configureMediaStore();
      configureRealChatStartup(store);
      const chat = await client.startChat([]);
      const history = inlineMediaHistory();

      await client.setHistory(history);

      const snapshot = client['_previousHistory'];
      const local = snapshot?.[0]?.blocks[0];
      if (
        snapshot === undefined ||
        local?.type !== 'media' ||
        local.encoding !== 'reference'
      ) {
        throw new Error('Expected initialized media reference snapshot');
      }
      expect({
        snapshotMatchesChat: isDeepStrictEqual(snapshot, chat.getHistory()),
        retainedRawData: JSON.stringify(snapshot).includes(PNG_BASE64),
        url: snapshot[0]?.blocks[1],
        reserved: await store.hasReservations(local.contentId),
      }).toStrictEqual({
        snapshotMatchesChat: true,
        retainedRawData: false,
        url: history[0]?.blocks[1],
        reserved: true,
      });

      await client.dispose();
      const reclaimed = await store.reclaimUnreferenced(
        new Set<string>(),
        Date.now() + 1,
      );
      expect({
        reserved: await store.hasReservations(local.contentId),
        objectsRemoved: reclaimed.objectsRemoved,
      }).toStrictEqual({ reserved: false, objectsRemoved: 1 });
    });

    it('transfers initialized media into deferred ownership during reinitialization', async () => {
      const store = configureMediaStore();
      configureRealChatStartup(store);
      const chat = await client.startChat([]);
      await client.setHistory(inlineMediaHistory());
      const activeBlock = chat.getHistory()[0]?.blocks[0];
      if (
        activeBlock.type !== 'media' ||
        activeBlock.encoding !== 'reference'
      ) {
        throw new Error('Expected active media reference');
      }

      await client.initialize({
        model: 'next-model',
        apiKey: 'test-key',
        vertexai: false,
      });

      const deferredBlock = deferredReference();
      expect({
        sameContent: deferredBlock.contentId === activeBlock.contentId,
        retainedRawData: JSON.stringify(client['_previousHistory']).includes(
          PNG_BASE64,
        ),
        reserved: await store.hasReservations(deferredBlock.contentId),
      }).toStrictEqual({
        sameContent: true,
        retainedRawData: false,
        reserved: true,
      });

      await client.dispose();
      expect(await store.hasReservations(deferredBlock.contentId)).toBe(false);
    });

    it('releases initialized chat media when setHistory replaces or deletes it', async () => {
      const store = configureMediaStore();
      configureRealChatStartup(store);
      const chat = await client.startChat([]);

      await client.setHistory(inlineMediaHistory());
      const firstBlock = chat.getHistory()[0]?.blocks[0];
      if (firstBlock.type !== 'media' || firstBlock.encoding !== 'reference') {
        throw new Error('Expected first initialized media reference');
      }
      await client.setHistory(inlineMediaHistory(SECOND_IMAGE_BASE64));
      const secondBlock = chat.getHistory()[0]?.blocks[0];
      if (
        secondBlock.type !== 'media' ||
        secondBlock.encoding !== 'reference'
      ) {
        throw new Error('Expected second initialized media reference');
      }
      const afterReplacement = {
        first: await store.hasReservations(firstBlock.contentId),
        second: await store.hasReservations(secondBlock.contentId),
      };

      await client.setHistory([]);

      expect({
        afterReplacement,
        afterDeletion: await store.hasReservations(secondBlock.contentId),
      }).toStrictEqual({
        afterReplacement: { first: false, second: true },
        afterDeletion: false,
      });
    });

    it('retries retained ownership cleanup after dispose reports a release failure', async () => {
      const store = new FailOnceReleaseStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      });
      Object.defineProperty(client['config'], 'getLocalMediaStore', {
        configurable: true,
        value: () => store,
      });
      configureRealChatStartup(store);
      const chat = await client.startChat([]);
      await client.setHistory(inlineMediaHistory());
      const block = chat.getHistory()[0]?.blocks[0];
      if (block.type !== 'media' || block.encoding !== 'reference') {
        throw new Error('Expected initialized media reference');
      }

      await expect(client.dispose()).rejects.toThrow(
        'Agent client disposal failed',
      );
      const reservedAfterFailure = await store.hasReservations(block.contentId);
      await client.dispose();

      expect({
        reservedAfterFailure,
        reservedAfterRetry: await store.hasReservations(block.contentId),
      }).toStrictEqual({
        reservedAfterFailure: true,
        reservedAfterRetry: false,
      });
    });
  });
});
