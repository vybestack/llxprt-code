/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: LoggingProviderWrapper.projectPromptEnvelope must hand the
 * wrapped provider the SAME normalized options that generateChatCompletion
 * hands it (issue #2817).
 *
 * ProviderManager registers a runtime-context resolver and an options
 * normalizer on this wrapper and returns it as the outermost provider the
 * agent send seam consumes. If projection forwards raw options while transport
 * forwards normalized options, the envelope that was estimated is not the
 * envelope that gets sent — exactly the drift issue #2817 exists to remove.
 */

import { describe, it, expect, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from '../IProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

function makeContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

/** Minimal Config shape the wrapper's logging path validates. */
function buildConfigStub(): Config {
  return {
    getConversationLoggingEnabled: () => false,
    getRedactionConfig: () => ({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    }),
    getProviderManager: () => ({ accumulateSessionTokens: () => {} }),
  } as unknown as Config;
}

interface ObservedOptions {
  readonly runtimeId: string | undefined;
  readonly settingsPresent: boolean;
  readonly configPresent: boolean;
  readonly metadataSource: unknown;
  readonly normalizerApplied: unknown;
}

function observe(options: GenerateChatOptions): ObservedOptions {
  return {
    runtimeId: options.runtime?.runtimeId,
    settingsPresent: options.settings !== undefined,
    configPresent: (options.config ?? options.runtime?.config) !== undefined,
    metadataSource: options.metadata?.source,
    normalizerApplied: options.metadata?.normalizerApplied,
  };
}

/**
 * Records the options each seam actually receives so the test can compare the
 * projection input against the transport input.
 */
class RecordingProvider implements IProvider {
  readonly name = 'recording-provider';
  projectionInput: ObservedOptions | undefined;
  transportInput: ObservedOptions | undefined;

  async getModels(): Promise<IModel[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'test-model';
  }

  async *generateChatCompletion(
    optionsOrContents: GenerateChatOptions | IContent[],
    _tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    if (!Array.isArray(optionsOrContents)) {
      this.transportInput = observe(optionsOrContents);
    }
    yield makeContent('ok');
  }

  async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    this.projectionInput = observe(options);
    const serialized = JSON.stringify(options.contents);
    const tokens = Math.max(Math.ceil(serialized.length / 4), 1);
    return {
      model: 'test-model',
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      finalizedProjection: Object.freeze({}),
      legacyEstimate: () => Promise.resolve(tokens),
    };
  }
}

/** Wire the wrapper the way ProviderManager.syncProviderRuntime does. */
function buildManagedWrapper(base: RecordingProvider): {
  wrapper: LoggingProviderWrapper;
  runtime: ProviderRuntimeContext;
} {
  const settings = new SettingsService();
  const config = buildConfigStub();
  const runtime: ProviderRuntimeContext = {
    settingsService: settings,
    config,
    runtimeId: 'managed-runtime',
    metadata: { source: 'ProviderManager.syncProviderRuntime' },
  };

  const wrapper = new LoggingProviderWrapper(base);
  wrapper.setRuntimeContextResolver(() => runtime);
  wrapper.setOptionsNormalizer((options) => ({
    ...options,
    metadata: { ...options.metadata, normalizerApplied: true },
  }));

  return { wrapper, runtime };
}

describe('LoggingProviderWrapper projection normalization parity (issue #2817)', () => {
  it('injects the resolved runtime context into projection options', async () => {
    const base = new RecordingProvider();
    const { wrapper } = buildManagedWrapper(base);

    await wrapper.projectPromptEnvelope({ contents: [makeContent('Hello')] });

    expect(base.projectionInput?.runtimeId).toBe('managed-runtime');
    expect(base.projectionInput?.settingsPresent).toBe(true);
    expect(base.projectionInput?.configPresent).toBe(true);
  });

  it('applies the ProviderManager options normalizer to projection options', async () => {
    const base = new RecordingProvider();
    const { wrapper } = buildManagedWrapper(base);

    await wrapper.projectPromptEnvelope({ contents: [makeContent('Hello')] });

    expect(base.projectionInput?.normalizerApplied).toBe(true);
  });

  it('hands projection the same normalized runtime/settings/config as transport', async () => {
    const base = new RecordingProvider();
    const { wrapper } = buildManagedWrapper(base);
    const rawOptions: GenerateChatOptions = {
      contents: [makeContent('Hello')],
    };

    await wrapper.projectPromptEnvelope(rawOptions);
    for await (const _chunk of wrapper.generateChatCompletion(rawOptions)) {
      // drain
    }

    expect(base.projectionInput).toBeDefined();
    expect(base.transportInput).toBeDefined();

    // Assert against KNOWN EXPECTED values so a normalization-absent seam
    // fails the test on its own, not just by comparison to the other seam.
    // (Comparing the seams to each other alone passes vacuously when both are
    // undefined, which would hide normalization being skipped on both.)
    expect(base.projectionInput?.runtimeId).toBe('managed-runtime');
    expect(base.projectionInput?.settingsPresent).toBe(true);
    expect(base.projectionInput?.configPresent).toBe(true);
    expect(base.projectionInput?.metadataSource).toBe(
      'LoggingProviderWrapper.generateChatCompletion',
    );
    expect(base.projectionInput?.normalizerApplied).toBe(true);

    expect(base.transportInput?.runtimeId).toBe('managed-runtime');
    expect(base.transportInput?.settingsPresent).toBe(true);
    expect(base.transportInput?.configPresent).toBe(true);
    expect(base.transportInput?.metadataSource).toBe(
      'LoggingProviderWrapper.generateChatCompletion',
    );
    expect(base.transportInput?.normalizerApplied).toBe(true);

    // Also verify parity between the two seams.
    expect(base.projectionInput?.runtimeId).toBe(
      base.transportInput?.runtimeId,
    );
    expect(base.projectionInput?.settingsPresent).toBe(
      base.transportInput?.settingsPresent,
    );
    expect(base.projectionInput?.configPresent).toBe(
      base.transportInput?.configPresent,
    );
    expect(base.projectionInput?.normalizerApplied).toBe(
      base.transportInput?.normalizerApplied,
    );
    expect(base.projectionInput?.metadataSource).toBe(
      base.transportInput?.metadataSource,
    );
  });

  it('fails fast when no runtime context can be resolved for a projection', async () => {
    // Transport rejects an unresolvable runtime; projection must not silently
    // prepare an envelope against provider-default state instead.
    const base = new RecordingProvider();
    const wrapper = new LoggingProviderWrapper(base);

    await expect(
      wrapper.projectPromptEnvelope({ contents: [makeContent('Hello')] }),
    ).rejects.toThrow(/runtime/i);
    expect(base.projectionInput).toBeUndefined();
  });

  it('reports absent capability without normalization side effects', async () => {
    const plain: IProvider = {
      name: 'plain-provider',
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield makeContent('ok');
      },
    };
    const settings = new SettingsService();
    const wrapper = new LoggingProviderWrapper(plain);
    const normalize = vi.fn((options: GenerateChatOptions) => options);
    const options = { contents: [makeContent('Hello')] };
    const snapshot = structuredClone(options);
    wrapper.setRuntimeContextResolver(() => ({
      settingsService: settings,
      config: buildConfigStub(),
      runtimeId: 'plain-runtime',
      metadata: {},
    }));
    wrapper.setOptionsNormalizer(normalize);

    await expect(
      wrapper.projectPromptEnvelope(options),
    ).resolves.toBeUndefined();
    expect(normalize).not.toHaveBeenCalled();
    expect(options).toStrictEqual(snapshot);
  });
});
