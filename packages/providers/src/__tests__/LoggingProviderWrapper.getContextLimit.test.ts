/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

class FakeProviderBase implements IProvider {
  readonly name: string;
  isDefault = false;
  constructor(name: string) {
    this.name = name;
  }
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'fake-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return {};
  }
  async *generateChatCompletion(
    _contentOrOptions: IContent[] | GenerateChatOptions,
    _tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text' as const, text: 'ok' }],
    } as IContent;
  }
}

class FakeProviderWithContextLimit extends FakeProviderBase {
  private readonly limit: number;
  constructor(name: string, limit: number) {
    super(name);
    this.limit = limit;
  }
  getContextLimit(): number {
    return this.limit;
  }
}

describe('LoggingProviderWrapper.getContextLimit() passthrough (issue #2251)', () => {
  it('passes getContextLimit through to the wrapped provider when present', () => {
    const wrapper = new LoggingProviderWrapper(
      new FakeProviderWithContextLimit('fake-with-limit', 200_000),
    );

    expect(wrapper.getContextLimit?.()).toBe(200_000);
  });

  it('returns undefined when the wrapped provider lacks getContextLimit', () => {
    const wrapper = new LoggingProviderWrapper(
      new FakeProviderBase('fake-without-limit'),
    );

    expect(wrapper.getContextLimit?.()).toBeUndefined();
  });

  it('propagates getContextLimit through the full wrapper chain (issue #2251)', () => {
    // Mirrors the production wrapping order:
    // LoggingProviderWrapper(RetryOrchestrator(baseProvider))
    const chain = new LoggingProviderWrapper(
      new RetryOrchestrator(
        new FakeProviderWithContextLimit('lb-like', 200_000),
      ),
    );

    expect(chain.getContextLimit?.()).toBe(200_000);
  });
});
