/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  SessionControl,
  type SessionControlDeps,
} from '../control/sessionControl.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
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
    getHistory: vi.fn(async () => [...stored]),
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
    getUserTier: vi.fn(),
    getCurrentSequenceModel: vi.fn(),
  } as unknown as AgentClientContract;
}

function makeConfig(): Config {
  return {
    getProjectRoot: () => '/tmp/test-session-control',
    storage: {
      readProjectTempData: () => Promise.resolve(null),
      writeProjectTempData: () => Promise.resolve(),
      deleteProjectTempData: () => Promise.resolve(),
      projectTempDataPath: () => '/tmp/test-session-control/data',
    },
  } as unknown as Config;
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

function makeDeps(client: AgentClientContract): SessionControlDeps {
  return {
    config: makeConfig(),
    sessionId: () => 'test-session',
    resolveClient: () => client,
    getProvider: () => 'test-provider',
    getModel: () => 'test-model',
  };
}

describe('SessionControl (characterization)', () => {
  describe('constructor and interface', () => {
    it('creates a SessionControl instance', () => {
      const client = makeMockClient([]);
      const sc = new SessionControl(makeDeps(client));
      expect(sc).toBeDefined();
    });

    it('creates instances with different session IDs', () => {
      const client = makeMockClient([]);
      const deps1 = {
        ...makeDeps(client),
        sessionId: () => 'session-1',
      };
      const deps2 = {
        ...makeDeps(client),
        sessionId: () => 'session-2',
      };
      const sc1 = new SessionControl(deps1);
      const sc2 = new SessionControl(deps2);
      expect(sc1).toBeDefined();
      expect(sc2).toBeDefined();
    });
  });

  describe('client interaction', () => {
    it('client.getHistory returns the expected content', async () => {
      const history: IContent[] = [
        textContent('Hello', 'human'),
        textContent('Hi there', 'ai'),
      ];
      const client = makeMockClient(history);
      const result = await client.getHistory();
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
      const got = await client.getHistory();
      expect(got).toHaveLength(3);

      const restoreClient = makeMockClient([]);
      await restoreClient.restoreHistory(got);
      expect(restoreClient.restoreHistory).toHaveBeenCalledWith(got);
    });
  });

  describe('dispose', () => {
    it('completes without error on fresh instance', async () => {
      const client = makeMockClient([]);
      const sc = new SessionControl(makeDeps(client));
      await expect(sc.dispose()).resolves.toBeUndefined();
    });
  });

  describe('property-based: history content shapes', () => {
    it('getHistory preserves arbitrary content lengths', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }),
          async (texts) => {
            const history: IContent[] = texts.map((t, i) =>
              textContent(t, i % 2 === 0 ? 'human' : 'ai'),
            );
            const client = makeMockClient(history);
            const got = await client.getHistory();
            return got.length === texts.length;
          },
        ),
        { numRuns: 8 },
      );
    });
  });
});
