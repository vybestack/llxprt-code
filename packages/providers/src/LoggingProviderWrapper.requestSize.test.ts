/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { afterEach, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import {
  captureProviderRequestDiagnostics,
  type ProviderRequestDiagnostics,
} from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ApiRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import {
  SettingsService,
  type SettingsService as SettingsServiceType,
} from '@vybestack/llxprt-code-settings';
import { LoggingProviderWrapper } from './LoggingProviderWrapper.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions, IProvider } from './IProvider.js';
import { reportRequestSize } from './logging/requestSizeReport.js';

type Send = (options: GenerateChatOptions) => AsyncIterableIterator<IContent>;

class SendingProvider implements IProvider {
  name = 'sizing-provider';
  isDefault = false;
  constructor(private readonly send: Send) {}
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'sizing-model';
  }
  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    content: AsyncIterable<IContent>,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    options: GenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncIterableIterator<IContent> {
    if (!('contents' in options)) throw new Error('Expected call options');
    return this.send(options);
  }
}

const reply: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'ok' }],
};

const owners: SessionSettingsOwner[] = [];

async function* humanRows(): AsyncGenerator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] };
}

interface Harness {
  readonly requests: ApiRequestEvent[];
  run(): Promise<void>;
  readonly options: () => GenerateChatOptions;
}

function harness(send: Send): Harness {
  const config = new Config({
    sessionId: 'request-size',
    cwd: process.cwd(),
    targetDir: process.cwd(),
    model: 'test',
    debugMode: false,
    telemetry: { enabled: false },
  });
  const settings = new SettingsService();
  const owner = new SessionSettingsOwner(settings);
  owner.bindTelemetry(config);
  owners.push(owner);
  const requests: ApiRequestEvent[] = [];
  const diagnostics: ProviderRequestDiagnostics = {
    ...captureProviderRequestDiagnostics(config, owner),
    conversationLoggingEnabled: false,
    requestBodyLoggingEnabled: false,
    recordApiRequest: (event) => {
      requests.push(event);
    },
  };
  const provider = new SendingProvider(send);
  const wrapper = new LoggingProviderWrapper(
    provider,
    config,
    undefined,
    () => diagnostics,
  );
  const runtime: ProviderRuntimeContext = {
    settingsService: settings as unknown as SettingsServiceType,
    config,
    runtimeId: 'request-size-runtime',
    metadata: { source: 'LoggingProviderWrapper.requestSize.test' },
  };
  const options = (): GenerateChatOptions => ({
    contents: humanRows(),
    invocation: captureProviderInvocation(runtime, provider.name),
  });
  return {
    requests,
    options,
    run: async () => {
      for await (const chunk of wrapper.generateChatCompletion(options())) {
        void chunk;
      }
    },
  };
}

describe('api_request carries the size the provider reports', () => {
  afterEach(async () => {
    await Promise.all(owners.splice(0).map((owner) => owner.dispose()));
  });

  it('records the event with the reported size before the response streams', async () => {
    const seenWhenStreaming: number[] = [];
    const rig = harness(async function* (options) {
      reportRequestSize(options.metadata, 48213);
      seenWhenStreaming.push(rig.requests.length);
      yield reply;
    });

    await rig.run();

    expect(seenWhenStreaming).toStrictEqual([1]);
    expect(rig.requests).toHaveLength(1);
    expect(rig.requests[0].request_chars).toBe(48213);
    expect(rig.requests[0].request_text).toBeUndefined();
    expect(rig.requests[0].request_artifact).toBeUndefined();
  });

  it('keeps the first size when a retried attempt reports again', async () => {
    const rig = harness(async function* (options) {
      reportRequestSize(options.metadata, 100);
      reportRequestSize(options.metadata, 250);
      yield reply;
    });

    await rig.run();

    expect(rig.requests.map((event) => event.request_chars)).toStrictEqual([
      100,
    ]);
  });

  it('still records the event, without a size, for a provider that never reports', async () => {
    const rig = harness(async function* () {
      yield reply;
    });

    await rig.run();

    expect(rig.requests).toHaveLength(1);
    expect(rig.requests[0].request_chars).toBeUndefined();
  });

  it('records the event when the provider fails before it builds a body', async () => {
    const rig = harness(async function* () {
      yield* [];
      throw new Error('credentials rejected');
    });

    await expect(rig.run()).rejects.toThrow('credentials rejected');

    expect(rig.requests).toHaveLength(1);
    expect(rig.requests[0].request_chars).toBeUndefined();
  });
});
