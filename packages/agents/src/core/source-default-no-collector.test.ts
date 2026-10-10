/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP16 part 2: the source route is the only route. A default
 * (unflagged) stream send and a default turn send must reach the provider with
 * request rows without ever collecting the history into an array, and must
 * leave no open reader or pinned snapshot behind once the send settles.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Mock } from 'bun:test';
import * as providerCollect from '@vybestack/llxprt-code-providers/utils/collectContents.js';
import {
  StreamEventType,
  type StreamEvent,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { ProviderCuratedStreamOptions } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '@vybestack/llxprt-code-providers/IProvider.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { ChatSession } from './chatSession.js';

interface ReaderCensus {
  opened: number;
  active: number;
  snapshots: number;
  closedSnapshots: number;
}

/** Real snapshot preparation, with every reader and snapshot counted. */
class CountingHistory extends HistoryService {
  readonly census: ReaderCensus = {
    opened: 0,
    active: 0,
    snapshots: 0,
    closedSnapshots: 0,
  };

  override async prepareCuratedForProviderSnapshot(
    pending: readonly IContent[] = [],
    options: ProviderCuratedStreamOptions = {},
    override?: Iterable<IContent> | AsyncIterable<IContent>,
  ): Promise<ProviderRequestSnapshot> {
    const snapshot = await super.prepareCuratedForProviderSnapshot(
      pending,
      options,
      override,
    );
    const census = this.census;
    census.snapshots++;
    return {
      count: snapshot.count,
      pending: snapshot.pending,
      isPending: (index) => snapshot.isPending(index),
      async *openReader(signal): AsyncGenerator<IContent, void, unknown> {
        census.opened++;
        census.active++;
        try {
          yield* snapshot.openReader(signal);
        } finally {
          census.active--;
        }
      },
      close() {
        census.closedSnapshots++;
        snapshot.close();
      },
    };
  }
}

function seedHistory(history: HistoryService): void {
  for (let turn = 0; turn < 3; turn++) {
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: `question ${turn}` }],
    });
    history.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: `answer ${turn}` }],
    });
  }
}

interface Fixture {
  readonly chat: ChatSession;
  readonly history: CountingHistory;
  readonly providerRows: number[];
}

function createFixture(): Fixture {
  const providerRows: number[] = [];
  const provider: IProvider = {
    name: 'source-default-provider',
    getDefaultModel: () => 'source-default-model',
    getModels: () => Promise.resolve([]),
    generateChatCompletion(request): AsyncIterableIterator<IContent> {
      return (async function* (): AsyncIterableIterator<IContent> {
        if (!('contents' in request))
          throw new Error('Expected options with request rows');
        let rows = 0;
        for await (const _row of request.contents) rows++;
        providerRows.push(rows);
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'completed' }],
          metadata: { finishReason: 'stop', rawStopReason: 'STOP' },
        };
      })();
    },
  };
  const setup = createChatSessionRuntime({ provider });
  const history = new CountingHistory();
  seedHistory(history);
  const runtime = createAgentRuntimeContext({
    state: createAgentRuntimeState({
      runtimeId: 'source-default-no-collector',
      provider: provider.name,
      model: 'source-default-model',
      sessionId: 'source-default-no-collector',
    }),
    history,
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
  });
  const generator = {
    generateContent: async (): Promise<never> => {
      throw new Error('Unexpected content generator call');
    },
    generateContentStream: async (): Promise<never> => {
      throw new Error('Unexpected content generator call');
    },
    countTokens: async () => ({ totalTokens: 1 }),
    embedContent: async (): Promise<never> => {
      throw new Error('Unexpected embedding call');
    },
  };
  return {
    chat: new ChatSession(runtime, generator, {}, []),
    history,
    providerRows,
  };
}

async function streamedText(
  stream: AsyncGenerator<StreamEvent>,
): Promise<string> {
  const text: string[] = [];
  for await (const event of stream) {
    if (event.type !== StreamEventType.CHUNK) continue;
    text.push(
      ...event.value.content.blocks.flatMap((block) =>
        block.type === 'text' ? [block.text] : [],
      ),
    );
  }
  return text.join('');
}

describe('default sends never collect history into an array', () => {
  let collect: Mock<typeof providerCollect.collectContents>;

  beforeEach(() => {
    collect = spyOn(providerCollect, 'collectContents');
  });

  afterEach(() => {
    collect.mockRestore();
  });

  it('observes the collector when it is called (trap control)', async () => {
    await providerCollect.collectContents(
      (async function* (): AsyncGenerator<IContent> {
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] };
      })(),
    );
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('streams a default send from request rows with no open reader afterwards', async () => {
    const { chat, history, providerRows } = createFixture();
    const stream = await chat.sendMessageStream(
      { message: 'next question' },
      'default-stream',
    );
    expect(await streamedText(stream)).toContain('completed');
    expect(providerRows).toHaveLength(1);
    expect(providerRows[0]).toBeGreaterThan(6);
    expect(collect).not.toHaveBeenCalled();
    expect(history.census.snapshots).toBeGreaterThan(0);
    expect(history.census.opened).toBeGreaterThan(0);
    expect(history.census.active).toBe(0);
    expect(history.census.closedSnapshots).toBe(history.census.snapshots);
  });

  it('sends a default turn from request rows with no open reader afterwards', async () => {
    const { chat, history, providerRows } = createFixture();
    const response = await chat.sendMessage(
      { message: 'next question' },
      'default-turn',
    );
    expect(response.content.blocks).toContainEqual({
      type: 'text',
      text: 'completed',
    });
    expect(providerRows).toHaveLength(1);
    expect(providerRows[0]).toBeGreaterThan(6);
    expect(collect).not.toHaveBeenCalled();
    expect(history.census.snapshots).toBeGreaterThan(0);
    expect(history.census.opened).toBeGreaterThan(0);
    expect(history.census.active).toBe(0);
    expect(history.census.closedSnapshots).toBe(history.census.snapshots);
  });
});
