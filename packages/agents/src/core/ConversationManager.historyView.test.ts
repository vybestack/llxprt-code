/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ConversationManager.getHistory() return semantics
 * (issue #3109).
 *
 * getHistory() returns live HistoryService entries BY REFERENCE — no deep
 * clone. The returned array is a distinct instance (HistoryService.getAll()
 * and getCurated() already return fresh arrays), so array-level mutations
 * (push/splice) do not corrupt the live history. The readonly type enforces
 * the read-only contract at compile time.
 *
 * These tests build a REAL ConversationManager on top of a REAL
 * HistoryService + REAL AgentRuntimeContext (no mock theater) and assert
 * reference identity, array isolation, curation semantics, and content
 * equivalence.
 */

import * as fc from 'fast-check';
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { ConversationManager } from './ConversationManager.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

const GENERATING_MODEL = 'claude-opus-4-8';

function buildConversationManager(): {
  conversationManager: ConversationManager;
  historyService: HistoryService;
} {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));

  settingsService.set('providers.stub.base-url', 'https://stub.example.com');
  settingsService.set('providers.stub.auth-key', 'stub-api-key');
  settingsService.set('providers.stub.model', 'stub-model');

  const providerRuntime: ProviderRuntimeContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime.conversationManager.historyView',
    metadata: { source: 'ConversationManager.historyView.test' },
  });

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);

  const provider: IProvider = {
    name: 'stub',
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => GENERATING_MODEL,
    generateChatCompletion: vi.fn(async function* () {}),
    getServerTools: () => [],
    invokeServerTool: vi.fn(),
    getAuthToken: vi.fn(async () => 'stub-auth-token'),
  };
  manager.registerProvider(provider);

  const runtimeState = createAgentRuntimeState({
    runtimeId: 'runtime-conversationManager-historyView',
    provider: provider.name,
    model: GENERATING_MODEL,
    sessionId: config.getSessionId(),
  });
  const historyService = new HistoryService();
  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: { ...providerRuntime },
  });

  const conversationManager = new ConversationManager(historyService, view);

  return { conversationManager, historyService };
}

function makeHumanContent(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
}

function makeAiContent(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
  };
}

/**
 * getHistory() is typed `readonly IContent[]`, so TypeScript forbids callers
 * from push/splice. These tests deliberately re-type the SAME runtime array as
 * mutable to prove the RUNTIME guarantee behind that type: the array is a fresh
 * instance, so even an untyped JS consumer that ignores the readonly contract
 * cannot splice or reorder the live history.
 *
 * This covers MEMBERSHIP only. Entry contents are shared by reference (see the
 * AC1 tests), so nothing here implies `entry.blocks` is protected from in-place
 * mutation — that is an invariant of the history layer, pinned by the AC3 test.
 */
function asMutable(history: readonly IContent[]): IContent[] {
  return history as IContent[];
}

function makeToolContent(): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'test_tool',
        toolName: 'test_tool',
        result: { value: 42 },
      },
    ],
  };
}

describe('ConversationManager.getHistory() — reference semantics (issue #3109)', () => {
  let conversationManager: ConversationManager;
  let historyService: HistoryService;

  beforeEach(() => {
    ({ conversationManager, historyService } = buildConversationManager());
  });

  describe('AC1 — entries returned by reference, no deep clone', () => {
    it('returns entries that are reference-identical to HistoryService.getAll() entries', () => {
      conversationManager.addHistory(makeHumanContent('hello'));
      conversationManager.addHistory(makeAiContent('world'));

      const all = historyService.getAll();
      const result = conversationManager.getHistory();

      expect(result.length).toBe(all.length);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(all[i]);
      }
    });

    it('nested block objects are reference-identical (not deep copies)', () => {
      conversationManager.addHistory(makeHumanContent('hello'));
      const all = historyService.getAll();
      const result = conversationManager.getHistory();

      expect(result[0].blocks).toBe(all[0].blocks);
    });

    it('a large text block is the same object reference, not a copy', () => {
      const largeText = 'x'.repeat(100_000);
      conversationManager.addHistory(makeHumanContent(largeText));

      const all = historyService.getAll();
      const result = conversationManager.getHistory();

      // The block object itself must be === (no deep clone of the 100KB text)
      expect(result[0].blocks[0]).toBe(all[0].blocks[0]);
    });
  });

  describe('AC2 — array isolation preserved', () => {
    for (const curated of [false, true]) {
      it(`pushing onto the returned array does not affect a later getHistory() (curated: ${curated})`, () => {
        conversationManager.addHistory(makeHumanContent('hello'));
        conversationManager.addHistory(makeAiContent('world'));

        asMutable(conversationManager.getHistory(curated)).push(
          makeHumanContent('injected'),
        );

        const after = conversationManager.getHistory(curated);
        expect(after).toHaveLength(2);
        expect(after.map((entry) => entry.speaker)).toEqual(['human', 'ai']);
      });

      it(`splicing the returned array does not affect a later getHistory() (curated: ${curated})`, () => {
        conversationManager.addHistory(makeHumanContent('hello'));
        conversationManager.addHistory(makeAiContent('world'));

        asMutable(conversationManager.getHistory(curated)).splice(0, 1);

        const after = conversationManager.getHistory(curated);
        expect(after).toHaveLength(2);
        expect(after.map((entry) => entry.speaker)).toEqual(['human', 'ai']);
      });
    }

    it('two successive calls return distinct arrays but identical entry references', () => {
      conversationManager.addHistory(makeHumanContent('hello'));
      conversationManager.addHistory(makeAiContent('world'));

      const result1 = conversationManager.getHistory();
      const result2 = conversationManager.getHistory();

      expect(result1).not.toBe(result2);
      expect(result1.length).toBe(result2.length);
      for (let i = 0; i < result1.length; i++) {
        expect(result1[i]).toBe(result2[i]);
      }
    });
  });

  describe('AC3 — entries are shared, so the history layer must stay copy-on-write', () => {
    /**
     * Sharing entries by reference is only safe while every post-insertion
     * edit path REPLACES the array slot instead of mutating the stored entry.
     * This pins that invariant: if someone later makes replaceToolResponseBlock
     * (or any sibling edit path) mutate in place, a previously handed-out
     * history would silently change underneath its holder, and this test fails.
     */
    it('a previously returned history is not altered when a stored entry is edited', async () => {
      conversationManager.addHistory(makeHumanContent('run the tool'));
      conversationManager.addHistory({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'test_tool',
            parameters: {},
          },
        ],
      });
      conversationManager.addHistory(makeToolContent());

      const captured = conversationManager.getHistory();
      const capturedToolEntry = captured[2];
      const capturedBlocks = capturedToolEntry.blocks;

      const replaced = await historyService.replaceToolResponseBlock(
        2,
        0,
        {
          type: 'tool_response',
          callId: 'test_tool',
          toolName: 'test_tool',
          result: { value: 'edited' },
        },
        GENERATING_MODEL,
      );
      expect(replaced).toBe(true);

      // The captured entry and its blocks are untouched by the live edit.
      expect(captured[2]).toBe(capturedToolEntry);
      expect(capturedToolEntry.blocks).toBe(capturedBlocks);
      expect(capturedBlocks[0]).toMatchObject({ result: { value: 42 } });

      // ...and the live history really did change, so this is not vacuous.
      const fresh = conversationManager.getHistory();
      expect(fresh[2]).not.toBe(capturedToolEntry);
      expect(fresh[2].blocks[0]).toMatchObject({ result: { value: 'edited' } });
    });
  });

  describe('AC4 — curation semantics unchanged', () => {
    it('empty history returns an empty array for curated: false', () => {
      const result = conversationManager.getHistory(false);
      expect(result).toEqual([]);
    });

    it('empty history returns an empty array for curated: true', () => {
      const result = conversationManager.getHistory(true);
      expect(result).toEqual([]);
    });

    it('curated:true drops an invalid/empty AI entry while getAll keeps it', () => {
      conversationManager.addHistory(makeHumanContent('question'));
      conversationManager.addHistory({
        speaker: 'ai',
        blocks: [{ type: 'text', text: '' }],
      });

      const all = conversationManager.getHistory(false);
      const curated = conversationManager.getHistory(true);

      // getAll keeps both entries
      expect(all.length).toBe(2);
      // curated drops the invalid AI entry
      expect(curated.length).toBe(1);
      expect(curated[0].speaker).toBe('human');
    });

    it('human and tool entries always survive curation', () => {
      conversationManager.addHistory(makeHumanContent('do something'));
      conversationManager.addHistory(makeToolContent());
      conversationManager.addHistory({
        speaker: 'ai',
        blocks: [],
      });

      const curated = conversationManager.getHistory(true);
      expect(curated.length).toBe(2);
      expect(curated[0].speaker).toBe('human');
      expect(curated[1].speaker).toBe('tool');
    });
  });

  describe('AC5 — content equivalence unchanged', () => {
    it('addHistory → getHistory returns same length, speakers, and blocks', () => {
      conversationManager.addHistory(makeHumanContent('hello'));
      conversationManager.addHistory(makeAiContent('world'));
      conversationManager.addHistory(makeToolContent());

      const result = conversationManager.getHistory();
      expect(result).toHaveLength(3);
      expect(result[0].speaker).toBe('human');
      expect(result[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'hello',
      });
      expect(result[1].speaker).toBe('ai');
      expect(result[1].blocks[0]).toMatchObject({
        type: 'text',
        text: 'world',
      });
      expect(result[2].speaker).toBe('tool');
      expect(result[2].blocks[0]).toMatchObject({ type: 'tool_response' });
    });

    it('property: addHistory → getHistory preserves speaker and block count for ANY history', () => {
      const contentArb: fc.Arbitrary<IContent> = fc.oneof(
        fc.string({ minLength: 1 }).map(makeHumanContent),
        fc.string({ minLength: 1 }).map(makeAiContent),
        fc.constant(makeToolContent()),
      );

      fc.assert(
        fc.property(fc.array(contentArb, { maxLength: 20 }), (entries) => {
          conversationManager.clearHistory();
          for (const entry of entries) {
            conversationManager.addHistory(entry);
          }

          const result = conversationManager.getHistory();
          expect(result).toHaveLength(entries.length);
          expect(result.map((entry) => entry.speaker)).toEqual(
            entries.map((entry) => entry.speaker),
          );
          expect(result.map((entry) => entry.blocks.length)).toEqual(
            entries.map((entry) => entry.blocks.length),
          );
        }),
      );
    });
  });
});
