/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ConversationManager.getHistory() return semantics
 * (issue #3109).
 *
 * Raw and curated reads stream pinned journal membership. Pending raw rows
 * preserve caller identity; durable rows are decoded independently. Arrays
 * collected by these tests are test-owned. Editing their membership never
 * edits the journal.
 *
 * These tests build a REAL ConversationManager on top of a REAL
 * HistoryService + REAL AgentRuntimeContext (no mock theater) and assert
 * reference identity, array isolation, curation semantics, and content
 * equivalence.
 */

import { collectRowsForAssertions as withRows } from '@vybestack/llxprt-code-core/test-utils/collect-rows-for-assertions.js';
import * as fc from 'fast-check';
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { collectCuratedFixture } from '@vybestack/llxprt-code-core/services/history/curated-stream-test-helpers.js';
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
import { collectHistoryFixture } from './collect-history-test-fixture.js';

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

let conversationManager: ConversationManager;
let historyService: HistoryService;

function resetHistoryFixture(): void {
  ({ conversationManager, historyService } = buildConversationManager());
}

describe('AC1 — entries returned by reference, no deep clone', () => {
  beforeEach(resetHistoryFixture);
  it('returns entries that are reference-identical to HistoryService.getAll() entries', async () => {
    conversationManager.addHistory(makeHumanContent('hello'));
    conversationManager.addHistory(makeAiContent('world'));

    await withRows(historyService.streamRawHistory(), async (rows) => {
      const all = rows;
      const result = await collectHistoryFixture(
        conversationManager.getHistory(),
      );

      expect(result.length).toBe(all.length);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(all[i]);
      }
    });
  });

  it('nested block objects are reference-identical (not deep copies)', async () => {
    conversationManager.addHistory(makeHumanContent('hello'));
    await withRows(historyService.streamRawHistory(), async (rows) => {
      const all = rows;
      const result = await collectHistoryFixture(
        conversationManager.getHistory(),
      );

      expect(result[0].blocks).toBe(all[0].blocks);
    });
  });

  it('a large text block is the same object reference, not a copy', async () => {
    const largeText = 'x'.repeat(100_000);
    conversationManager.addHistory(makeHumanContent(largeText));

    await withRows(historyService.streamRawHistory(), async (rows) => {
      const all = rows;
      const result = await collectHistoryFixture(
        conversationManager.getHistory(),
      );

      // The block object itself must be === (no deep clone of the 100KB text)
      expect(result[0].blocks[0]).toBe(all[0].blocks[0]);
    });
  });
});

describe('AC2 — array isolation preserved', () => {
  beforeEach(resetHistoryFixture);
  for (const curated of [false, true]) {
    it(`mutating collected membership does not affect a later getHistory() (curated: ${curated})`, async () => {
      conversationManager.addHistory(makeHumanContent('hello'));
      conversationManager.addHistory(makeAiContent('world'));

      const membership = curated
        ? await collectCuratedFixture(conversationManager.getHistory(true))
        : await collectHistoryFixture(conversationManager.getHistory(false));
      Reflect.apply(Array.prototype.push, membership, [
        makeHumanContent('injected'),
      ]);

      const after = await collectCuratedFixture(
        conversationManager.getHistory(curated),
      );
      expect(after).toHaveLength(2);
      expect(after.map((entry) => entry.speaker)).toStrictEqual([
        'human',
        'ai',
      ]);
    });

    it(`removing collected membership does not affect a later getHistory() (curated: ${curated})`, async () => {
      conversationManager.addHistory(makeHumanContent('hello'));
      conversationManager.addHistory(makeAiContent('world'));

      const membership = curated
        ? await collectCuratedFixture(conversationManager.getHistory(true))
        : await collectHistoryFixture(conversationManager.getHistory(false));
      Reflect.apply(Array.prototype.splice, membership, [0, 1]);

      const after = await collectCuratedFixture(
        conversationManager.getHistory(curated),
      );
      expect(after).toHaveLength(2);
      expect(after.map((entry) => entry.speaker)).toStrictEqual([
        'human',
        'ai',
      ]);
    });
  }

  it('two successive calls return distinct arrays but identical entry references', async () => {
    conversationManager.addHistory(makeHumanContent('hello'));
    conversationManager.addHistory(makeAiContent('world'));

    const result1 = await collectHistoryFixture(
      conversationManager.getHistory(),
    );
    const result2 = await collectHistoryFixture(
      conversationManager.getHistory(),
    );

    expect(result1).not.toBe(result2);
    expect(result1.length).toBe(result2.length);
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i]).toBe(result2[i]);
    }
  });
});

describe('AC3 — entries are shared, so the history layer must stay copy-on-write', () => {
  beforeEach(resetHistoryFixture);
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

    const captured = await collectHistoryFixture(
      conversationManager.getHistory(),
    );
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
    const fresh = await collectHistoryFixture(conversationManager.getHistory());
    expect(fresh[2]).not.toBe(capturedToolEntry);
    expect(fresh[2].blocks[0]).toMatchObject({ result: { value: 'edited' } });
  });
});

describe('AC4 — curation semantics unchanged', () => {
  beforeEach(resetHistoryFixture);
  it('empty history yields no rows for curated: false', async () => {
    const result = await collectHistoryFixture(
      conversationManager.getHistory(false),
    );
    expect(result).toStrictEqual([]);
  });

  it('empty history yields no rows for curated: true', async () => {
    const result = await collectCuratedFixture(
      conversationManager.getHistory(true),
    );
    expect(result).toStrictEqual([]);
  });

  it('curated:true drops an invalid/empty AI entry while getAll keeps it', async () => {
    conversationManager.addHistory(makeHumanContent('question'));
    conversationManager.addHistory({
      speaker: 'ai',
      blocks: [{ type: 'text', text: '' }],
    });

    const all = await collectHistoryFixture(
      conversationManager.getHistory(false),
    );
    const curated = await collectCuratedFixture(
      conversationManager.getHistory(true),
    );

    // getAll keeps both entries
    expect(all.length).toBe(2);
    // curated drops the invalid AI entry
    expect(curated.length).toBe(1);
    expect(curated[0].speaker).toBe('human');
  });

  it('human and tool entries always survive curation', async () => {
    conversationManager.addHistory(makeHumanContent('do something'));
    conversationManager.addHistory(makeToolContent());
    conversationManager.addHistory({
      speaker: 'ai',
      blocks: [],
    });

    const curated = await collectCuratedFixture(
      conversationManager.getHistory(true),
    );
    expect(curated.length).toBe(2);
    expect(curated[0].speaker).toBe('human');
    expect(curated[1].speaker).toBe('tool');
  });
});

describe('AC5 — content equivalence unchanged', () => {
  beforeEach(resetHistoryFixture);
  it('addHistory → getHistory returns same length, speakers, and blocks', async () => {
    conversationManager.addHistory(makeHumanContent('hello'));
    conversationManager.addHistory(makeAiContent('world'));
    conversationManager.addHistory(makeToolContent());

    const result = await collectHistoryFixture(
      conversationManager.getHistory(),
    );
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

  it('property: addHistory → getHistory preserves speaker and block count for ANY history', async () => {
    const contentArb: fc.Arbitrary<IContent> = fc.oneof(
      fc.string({ minLength: 1 }).map(makeHumanContent),
      fc.string({ minLength: 1 }).map(makeAiContent),
      fc.constant(makeToolContent()),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(contentArb, { maxLength: 20 }),
        async (entries) => {
          conversationManager.clearHistory();
          for (const entry of entries) {
            conversationManager.addHistory(entry);
          }

          const result = await collectHistoryFixture(
            conversationManager.getHistory(),
          );
          expect(result).toHaveLength(entries.length);
          expect(result.map((entry) => entry.speaker)).toStrictEqual(
            entries.map((entry) => entry.speaker),
          );
          expect(result.map((entry) => entry.blocks.length)).toStrictEqual(
            entries.map((entry) => entry.blocks.length),
          );
        },
      ),
    );
  });
});
