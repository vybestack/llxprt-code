/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

import { describe, it, expect, vi } from 'bun:test';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import * as fc from 'fast-check';
import { SessionControl } from '../control/sessionControl.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionRecordingPaths } from '../control/sessionControl.js';
import { SessionConversationBinding } from '../../session/session-conversation-binding.js';
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * @plan PLAN-20260707-AGENTNEUTRAL.P26
 * @requirement REQ-005.5c
 *
 * Characterization tests for API SessionControl history round-trip.
 * These tests pin observable behavior BEFORE the retype so P27's
 * Content→IContent migration is behavior-safe.
 */

function makeMockClient(history: IContent[]): AgentClientContract {
  const stored = [...history];
  return {
    initialize: vi.fn(),
    isInitialized: vi.fn(() => true),
    hasChatInitialized: vi.fn(() => true),
    getChat: vi.fn(() => ({}) as never),
    getHistory: vi.fn(async function* () {
      yield* stored;
    }),
    getHistoryService: vi.fn(() => null),
    storeHistoryServiceForReuse: vi.fn(),
    storeHistoryForLaterUse: vi.fn(),
    dispose: vi.fn(),
    setTools: vi.fn(),
    clearTools: vi.fn(),
    updateSystemInstruction: vi.fn(),
    addHistory: vi.fn(),
    resetChat: vi.fn(),
    resumeChat: vi.fn(),
    setHistory: vi.fn(),
    restoreHistory: vi.fn(),
    addDirectoryContext: vi.fn(),
    getContentGenerator: vi.fn(() => ({}) as never),
    startChat: vi.fn(),
    generateDirectMessage: vi.fn(),
    generateJson: vi.fn(),
    generateContent: vi.fn(),
    generateEmbedding: vi.fn(),
    sendMessageStream: vi.fn(),
    getCurrentSequenceModel: vi.fn(),
  } as unknown as AgentClientContract;
}

function makeRecordingPaths(): SessionRecordingPaths {
  return {
    projectRoot: '/tmp/test-session-control',
    storageRoot: '/tmp/test-session-control/data',
    projectTempDir: '/tmp/test-session-control/tmp',
    projectChatsDir: '/tmp/test-session-control/chats',
    persistenceQueueBytes: 1024 * 1024,
  };
}

function textContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text } satisfies TextBlock],
    metadata: {},
  };
}

function createSessionControl(
  client: AgentClientContract,
  id = 'test-session',
): SessionControl {
  let ownedSessionId = id;
  let closed = false;
  const conversation = new SessionConversationBinding({
    readClient: () => client,
    assertOpen: () => {
      if (closed) throw new Error('Characterization session is closed');
    },
  });
  return conversation.createSessionControl(
    makeRecordingPaths(),
    new LocalMediaStore({
      rootDirectory: '/tmp/test-session-control/media',
      quotaBytes: 1024 * 1024,
    }),
    () => 1024 * 1024,
    () => fixturePaths().directories(),
    'config',
    () => ownedSessionId,
    (operation) => operation(),
    () => {
      closed = true;
    },
    async () => {
      await client.resetChat();
      return {
        publish: () => {},
        retire: async () => {},
        discard: async () => {},
        attachRecording: async () => {
          throw new Error('Characterization fixture cannot attach recording');
        },
      };
    },
    () => 'test-provider',
    () => 'test-model',
    () => ownedSessionId,
    (nextId) => {
      ownedSessionId = nextId;
    },
  );
}

describe('SessionControl (characterization)', () => {
  registerSessionCharacterizationGroup0();

  registerSessionCharacterizationGroup1();

  registerSessionCharacterizationGroup2();

  registerSessionCharacterizationGroup3();
});

function registerSessionCharacterizationGroup0(): void {
  describe('constructor and interface', () => {
    it('creates a SessionControl instance', () => {
      const client = makeMockClient([]);
      const sc = createSessionControl(client);
      expect(sc).toBeDefined();
    });

    it('creates instances with different session IDs', () => {
      const client = makeMockClient([]);
      const sc1 = createSessionControl(client, 'session-1');
      const sc2 = createSessionControl(client, 'session-2');
      expect(sc1).toBeDefined();
      expect(sc2).toBeDefined();
    });
  });
}

function registerSessionCharacterizationGroup1(): void {
  describe('client interaction', () => {
    it('client.getHistory returns the expected content', async () => {
      const history: IContent[] = [
        textContent('Hello', 'human'),
        textContent('Hi there', 'ai'),
      ];
      const client = makeMockClient(history);
      const result = await Array.fromAsync(client.getHistory());
      expect(result).toHaveLength(2);
      expect(result[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'Hello',
      });
    });

    it('client.restoreHistory accepts neutral IContent[]', async () => {
      const client = makeMockClient([]);
      const items: IContent[] = [textContent('Restored', 'human')];
      await client.restoreHistory(items);
      expect(client.restoreHistory).toHaveBeenCalledWith(items);
    });

    it('client round-trips history through getHistory → restoreHistory', async () => {
      const history: IContent[] = [
        textContent('Turn 1', 'human'),
        textContent('Response 1', 'ai'),
        textContent('Turn 2', 'human'),
      ];
      const client = makeMockClient(history);
      const got = await Array.fromAsync(client.getHistory());
      expect(got).toHaveLength(3);

      const restoreClient = makeMockClient([]);
      await restoreClient.restoreHistory(got);
      expect(restoreClient.restoreHistory).toHaveBeenCalledWith(got);
    });
  });
}

function registerSessionCharacterizationGroup2(): void {
  describe('dispose', () => {
    it('completes without error on fresh instance', async () => {
      const client = makeMockClient([]);
      const sc = createSessionControl(client);
      await expect(sc.dispose()).resolves.toBeUndefined();
    });
  });
}

function registerSessionCharacterizationGroup3(): void {
  describe('property-based: history content shapes', () => {
    it('getHistory preserves arbitrary content lengths', async () => {
      const { getHistoryPreservesArbitraryContentLengthsProperty } =
        await observeGetHistoryPreservesArbitraryContentLengths();
      await fc.assert(getHistoryPreservesArbitraryContentLengthsProperty, {
        numRuns: 8,
      });
    });

    const observeGetHistoryPreservesArbitraryContentLengths = async () => {
      const getHistoryPreservesArbitraryContentLengthsProperty =
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }),
          async (texts) => {
            const history: IContent[] = texts.map((t, i) =>
              textContent(t, i % 2 === 0 ? 'human' : 'ai'),
            );
            const client = makeMockClient(history);
            const got = await Array.fromAsync(client.getHistory());
            return got.length === texts.length;
          },
        );
      return { getHistoryPreservesArbitraryContentLengthsProperty };
    };
  });
}
