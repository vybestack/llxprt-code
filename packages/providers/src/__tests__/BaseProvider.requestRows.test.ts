/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';

class NeutralRowsProvider extends BaseProvider {
  received: NormalizedGenerateChatOptions | undefined;

  constructor() {
    super({ name: 'neutral-rows' });
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'neutral-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.received = options;
    await Promise.resolve();
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
  }
}

const row = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});

interface Probe {
  readonly selection: ProviderRequestSelection;
  readonly state: { opened: number; closed: number; signals: unknown[] };
}

function probe(rows: IContent[], failAtOpen?: number): Probe {
  const state = { opened: 0, closed: 0, signals: [] as unknown[] };
  const selection: ProviderRequestSelection = {
    count: rows.length,
    async *openReader(signal) {
      const open = ++state.opened;
      state.signals.push(signal);
      await Promise.resolve();
      if (open === failAtOpen) throw new Error(`reader ${open} failed`);
      yield* rows;
    },
    close() {
      state.closed++;
    },
  };
  return { selection, state };
}

function callOptions(
  selection: ProviderRequestSelection,
  signal?: AbortSignal,
) {
  const settings = new SettingsService();
  const config = new Config({
    sessionId: 'request-rows',
    targetDir: process.cwd(),
    debugMode: false,
    cwd: process.cwd(),
    model: 'neutral-model',
  });
  const runtime = {
    settingsService: settings,
    config,
    runtimeId: 'request-rows',
  };
  return {
    contents: { [Symbol.asyncIterator]: () => selection.openReader(signal) },
    requestRows: selection,
    contentCount: selection.count,
    settings,
    config,
    runtime,
    invocation: createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: 'neutral-rows',
      ephemeralsSnapshot: {},
      ...(signal === undefined ? {} : { signal }),
    }),
    resolved: {
      model: 'neutral-model',
      baseURL: 'http://127.0.0.1:1',
      authToken: 'k',
    },
  };
}

describe('provider-neutral requestRows on a provider with no source transport', () => {
  it('receives the selection without rejection and materializes it from the bound reader', async () => {
    const controller = new AbortController();
    const { selection, state } = probe([row('a'), row('b')]);
    const provider = new NeutralRowsProvider();

    for await (const _ of provider.generateChatCompletion(
      callOptions(selection, controller.signal),
    )) {
      // drain
    }

    expect(provider.received?.requestRows).toBe(selection);
    expect(provider.received?.contents).toStrictEqual([row('a'), row('b')]);
    expect(state.opened).toBe(1);
    expect(state.signals).toStrictEqual([controller.signal]);
    // Closing stays with the caller that owns the selection.
    expect(state.closed).toBe(0);
  });

  it('surfaces a one-shot reader failure on first pull without invoking the transport', async () => {
    const { selection } = probe([row('a')], 1);
    const provider = new NeutralRowsProvider();

    await expect(
      provider.generateChatCompletion(callOptions(selection)).next(),
    ).rejects.toThrow('reader 1 failed');
    expect(provider.received).toBeUndefined();
  });

  it('serves a repeatable reader twice and fails on the reopen that breaks', async () => {
    const { selection, state } = probe([row('a')], 2);
    const first = new NeutralRowsProvider();
    for await (const _ of first.generateChatCompletion(
      callOptions(selection),
    )) {
      // drain
    }
    expect(first.received?.contents).toStrictEqual([row('a')]);

    const second = new NeutralRowsProvider();
    await expect(
      second.generateChatCompletion(callOptions(selection)).next(),
    ).rejects.toThrow('reader 2 failed');
    expect(state.opened).toBe(2);
  });

  it('does not open the reader when the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    const { selection, state } = probe([row('a')]);
    const provider = new NeutralRowsProvider();

    await expect(
      provider
        .generateChatCompletion(callOptions(selection, controller.signal))
        .next(),
    ).rejects.toThrow('stopped');
    expect(state.opened).toBe(0);
  });

  it('rejects a selection whose reader disagrees with its declared count', async () => {
    const { selection } = probe([row('a'), row('b')]);
    const lying: ProviderRequestSelection = {
      count: 3,
      openReader: (signal) => selection.openReader(signal),
      close: () => selection.close(),
    };
    const provider = new NeutralRowsProvider();

    await expect(
      provider.generateChatCompletion(callOptions(lying)).next(),
    ).rejects.toThrow('count changed');
  });
});
