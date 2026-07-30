/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: projectPromptEnvelope must be carried through the real
 * production wrapper chain (RetryOrchestrator + LoggingProviderWrapper), not
 * hidden behind an optional method that wrappers swallow (issue #2817,
 * finding #1).
 *
 * In production, providers are registered into ProviderManager which wraps
 * every provider: inner RetryOrchestrator, outer LoggingProviderWrapper.
 * If the wrappers do NOT delegate projectPromptEnvelope, the agent layer
 * receives a wrapped provider without the capability and estimation silently
 * never runs.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A3-A5, finding #1)
 */

import { describe, it, expect } from 'vitest';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from '../IProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';

function makeContent(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
}

/**
 * A minimal real provider that implements projectPromptEnvelope with real
 * counting logic (no mock theater). This is the same shape the three target
 * providers expose.
 */
class EstimatingProvider implements IProvider {
  readonly name = 'estimating-provider';
  projectionInvoked = false;

  async getModels(): Promise<IModel[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'test-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return undefined;
  }
  async *generateChatCompletion(
    _optionsOrContents: GenerateChatOptions | IContent[],
    _tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    yield makeContent('ok');
  }

  async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    this.projectionInvoked = true;
    const contents = options.contents;
    const serialized = JSON.stringify(contents);
    const count = Math.max(Math.ceil(serialized.length / 4), 1);
    return {
      model: 'test-model',
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: Object.freeze({}),
      countProjectedTokens: () => Promise.resolve(count),
    };
  }
}

/**
 * A provider that does NOT implement the projection seam (e.g. Gemini). The
 * wrapper chain must still be usable for it.
 */
class NonEstimatingProvider implements IProvider {
  readonly name = 'non-estimating-provider';

  async getModels(): Promise<IModel[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'test-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return undefined;
  }
  async *generateChatCompletion(
    _optionsOrContents: GenerateChatOptions | IContent[],
    _tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    yield makeContent('ok');
  }
}

describe('projectPromptEnvelope wrapper-chain delegation (issue #2817, finding #1)', () => {
  it('RetryOrchestrator delegates projectPromptEnvelope to the wrapped provider', async () => {
    const base = new EstimatingProvider();
    const orchestrator = new RetryOrchestrator(base);

    const options: GenerateChatOptions = {
      contents: [makeContent('Hello')],
    };

    // RetryOrchestrator is the OUTERMOST wrapper when no config (no
    // LoggingProviderWrapper). The capability must be visible on the
    // returned provider.
    expect(typeof orchestrator.projectPromptEnvelope).toBe('function');

    const projection = await orchestrator.projectPromptEnvelope(options);
    expect(base.projectionInvoked).toBe(true);
    expect(projection.protocol).toBe('anthropic-messages');
    expect(projection.model).toBe('test-model');

    const tokens = await projection.countProjectedTokens();
    expect(tokens).toBeGreaterThan(0);
  });

  it('LoggingProviderWrapper delegates projectPromptEnvelope to the wrapped provider', async () => {
    const base = new EstimatingProvider();
    const wrapper = new LoggingProviderWrapper(base);

    const options: GenerateChatOptions = {
      contents: [makeContent('Hello world')],
    };

    expect(typeof wrapper.projectPromptEnvelope).toBe('function');

    const projection = await wrapper.projectPromptEnvelope(options);
    expect(base.projectionInvoked).toBe(true);
    expect(projection.protocol).toBe('anthropic-messages');

    const tokens = await projection.countProjectedTokens();
    expect(tokens).toBeGreaterThan(0);
  });

  it('full wrapper chain (RetryOrchestrator inner, LoggingProviderWrapper outer) delegates projectPromptEnvelope', async () => {
    const base = new EstimatingProvider();
    const withRetry = new RetryOrchestrator(base);
    const fullChain = new LoggingProviderWrapper(withRetry);

    const options: GenerateChatOptions = {
      contents: [makeContent('Chain test')],
    };

    // The outermost provider (what ProviderManager.getActiveProvider returns)
    // must expose the capability.
    expect(typeof fullChain.projectPromptEnvelope).toBe('function');

    const projection = await fullChain.projectPromptEnvelope(options);
    // The BASE provider's real implementation was invoked (not swallowed).
    expect(base.projectionInvoked).toBe(true);
    expect(projection.protocol).toBe('anthropic-messages');
    expect(projection.method).toBe('messages/v1');

    const tokens = await projection.countProjectedTokens();
    expect(tokens).toBeGreaterThan(0);
  });

  it('reports absent capability (undefined) instead of throwing when the wrapped provider has no projection', async () => {
    // Gemini and other out-of-scope providers do not implement the seam.
    // ProviderManager still wraps them, so the wrapper chain must report the
    // capability as absent rather than throwing and breaking every send.
    const plain = new NonEstimatingProvider();
    const fullChain = new LoggingProviderWrapper(new RetryOrchestrator(plain));

    await expect(
      fullChain.projectPromptEnvelope({ contents: [makeContent('Hello')] }),
    ).resolves.toBeUndefined();
  });

  it('a larger content array produces a larger estimate through the full wrapper chain', async () => {
    const base = new EstimatingProvider();
    const fullChain = new LoggingProviderWrapper(new RetryOrchestrator(base));

    const small = await fullChain.projectPromptEnvelope({
      contents: [makeContent('Hi')],
    });
    const large = await fullChain.projectPromptEnvelope({
      contents: [
        makeContent('This is a much longer message with many more tokens.'),
        makeContent('And another message to increase the count further.'),
      ],
    });

    const smallTokens = await small.countProjectedTokens();
    const largeTokens = await large.countProjectedTokens();
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });
});
