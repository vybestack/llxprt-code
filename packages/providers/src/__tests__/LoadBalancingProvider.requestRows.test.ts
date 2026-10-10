/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The load balancer operates on a pinned requestRows selection (issue #854,
 * WP15): it never collects the request, reopens the same selection per
 * attempt and leaves no reader open once the call settles.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { isAsyncIterableContents } from '../utils/collectContents.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import {
  textRow,
  trackedRequestRows,
  type TrackedRequestRows,
} from './requestRowsTestSupport.js';

const AI_OK: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'ok' }],
};

function member(name: string, providerName: string): ResolvedSubProfile {
  return {
    name,
    providerName,
    model: `${providerName}-model`,
    baseURL: 'http://localhost',
    authToken: 'test-token',
    ephemeralSettings: {},
    modelParams: {},
  };
}

/** `contents` that fail loudly: the pinned selection is the only source. */
const poisonedContents: AsyncIterable<IContent> = {
  [Symbol.asyncIterator]() {
    throw new Error('request contents were read instead of requestRows');
  },
};

function requestOver(
  rows: TrackedRequestRows,
  extra: Partial<GenerateChatOptions> = {},
): GenerateChatOptions {
  return {
    contents: poisonedContents,
    requestRows: rows,
    contentCount: rows.count,
    readRequestRowsAtTransport: true,
    ...extra,
  };
}

function optionsOf(
  input: GenerateChatOptions | AsyncIterable<IContent>,
): GenerateChatOptions {
  if (isAsyncIterableContents(input)) {
    throw new Error('delegate received a bare stream instead of options');
  }
  return input;
}

async function readRows(options: GenerateChatOptions): Promise<IContent[]> {
  const rows = options.requestRows;
  if (rows === undefined) throw new Error('delegate got no requestRows');
  const out: IContent[] = [];
  for await (const row of rows.openReader(getRequestSignal(options)))
    out.push(row);
  return out;
}

function recordingDelegate(
  name: string,
  seen: IContent[][],
  failuresBeforeSuccess = 0,
): IProvider {
  let attempts = 0;
  return {
    name,
    async *generateChatCompletion(
      input: GenerateChatOptions | AsyncIterable<IContent>,
    ) {
      seen.push(await readRows(optionsOf(input)));
      if (attempts++ < failuresBeforeSuccess) {
        throw new Error('429 rate limited');
      }
      yield AI_OK;
    },
    getModels: async () => [],
    getDefaultModel: () => `${name}-model`,
  };
}

async function drain(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

function config(
  strategy: LoadBalancingProviderConfig['strategy'],
  extra: Partial<LoadBalancingProviderConfig> = {},
): LoadBalancingProviderConfig {
  return {
    profileName: 'rows-lb',
    strategy,
    lbProfileEphemeralSettings: {
      failover_retry_count: 1,
      failover_retry_delay_ms: 0,
    },
    subProfiles: [member('a', 'prov-a'), member('b', 'prov-b')],
    ...extra,
  };
}

describe('LoadBalancingProvider over a pinned requestRows selection (#854 WP15)', () => {
  let providerManager: ProviderManager;

  beforeEach(() => {
    const settingsService = new SettingsService();
    providerManager = new ProviderManager({
      settingsService,
      config: createRuntimeConfigStub(settingsService),
    });
    delegates.clear();
    providerManager.getProviderByName = (name) => delegates.get(name);
  });

  // Delegates are looked up directly: the logging wrapper's config needs are
  // not under test here.
  const delegates = new Map<string, IProvider>();
  const register = (provider: IProvider): void => {
    delegates.set(provider.name, provider);
  };

  const rowsOf = () => [textRow('first'), textRow('second')];

  it('round-robin sends the selection without reading contents and releases every reader', async () => {
    const seen: IContent[][] = [];
    register(recordingDelegate('prov-a', seen));
    register(recordingDelegate('prov-b', seen));
    const rows = trackedRequestRows(rowsOf());
    const lb = new LoadBalancingProvider(
      config('round-robin'),
      providerManager,
    );

    const out = await drain(lb.generateChatCompletion(requestOver(rows)));

    expect(out).toStrictEqual([AI_OK]);
    expect(seen).toStrictEqual([rowsOf()]);
    expect(rows.openReaders()).toBe(0);
    expect(rows.closeCount()).toBe(0);
  });

  it('failover reopens the same selection for every attempt with equal rows', async () => {
    const seen: IContent[][] = [];
    register(recordingDelegate('prov-a', seen, 1));
    register(recordingDelegate('prov-b', seen));
    const rows = trackedRequestRows(rowsOf());
    const lb = new LoadBalancingProvider(config('failover'), providerManager);

    const out = await drain(lb.generateChatCompletion(requestOver(rows)));

    expect(out).toStrictEqual([AI_OK]);
    expect(seen).toStrictEqual([rowsOf(), rowsOf()]);
    expect(rows.readersOpened()).toBeGreaterThanOrEqual(2);
    expect(rows.openReaders()).toBe(0);
    expect(rows.closeCount()).toBe(0);
  });

  it('sends the replacement selection when the context guard compresses, leaving the original untouched', async () => {
    const seen: IContent[][] = [];
    register(recordingDelegate('prov-a', seen));
    register(recordingDelegate('prov-b', seen));
    const original = trackedRequestRows([textRow('x'.repeat(2000))]);
    const replacement = trackedRequestRows([textRow('ok')]);
    const lb = new LoadBalancingProvider(
      config('round-robin', { contextLimit: 100 }),
      providerManager,
    );
    lb.setCompressionCallback(async (guard) => {
      expect(guard?.contextLimit).toBe(100);
      return replacement;
    });

    await drain(lb.generateChatCompletion(requestOver(original)));

    expect(seen).toStrictEqual([[textRow('ok')]]);
    expect(original.openReaders()).toBe(0);
    expect(replacement.openReaders()).toBe(0);
    expect(original.closeCount() + replacement.closeCount()).toBe(0);
  });

  it('releases the reader when the consumer returns after the first chunk', async () => {
    const rows = trackedRequestRows(rowsOf());
    register({
      name: 'prov-a',
      async *generateChatCompletion(
        input: GenerateChatOptions | AsyncIterable<IContent>,
      ) {
        const reader = optionsOf(input).requestRows!.openReader();
        try {
          yield AI_OK;
          for await (const _row of reader) yield AI_OK;
        } finally {
          await reader.return();
        }
      },
      getModels: async () => [],
      getDefaultModel: () => 'prov-a-model',
    });
    register(recordingDelegate('prov-b', []));
    const lb = new LoadBalancingProvider(
      config('round-robin'),
      providerManager,
    );

    const stream = lb.generateChatCompletion(requestOver(rows));
    expect((await stream.next()).value).toStrictEqual(AI_OK);
    await stream.return?.(undefined);

    expect(rows.openReaders()).toBe(0);
  });

  it('propagates an already-cancelled request signal to the reopened reader', async () => {
    const seen: IContent[][] = [];
    register(recordingDelegate('prov-a', seen));
    register(recordingDelegate('prov-b', seen));
    const rows = trackedRequestRows(rowsOf());
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const lb = new LoadBalancingProvider(
      config('round-robin'),
      providerManager,
    );

    await expect(
      drain(
        lb.generateChatCompletion(
          requestOver(rows, { metadata: { abortSignal: controller.signal } }),
        ),
      ),
    ).rejects.toThrow('cancelled');

    expect(seen).toStrictEqual([]);
    expect(rows.openReaders()).toBe(0);
  });
});
