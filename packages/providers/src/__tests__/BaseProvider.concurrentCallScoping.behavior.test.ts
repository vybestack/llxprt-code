/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2616 PR A — concurrent call-scoping on one provider instance.
 *
 * Two overlapping generateChatCompletion calls on the SAME BaseProvider
 * instance, each carrying its own explicit SettingsService, must observe
 * their own settings throughout. Isolation is provided by the instance-
 * owned activeCallContext AsyncLocalStorage (documented call scoping);
 * before the module-level ambient pointer was deleted, this overlap was
 * racy because the ambient pointer was a single process-wide slot.
 */

import { describe, expect, it } from 'bun:test';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

class ScopingProbeProvider extends BaseProvider {
  constructor(settingsService: SettingsService) {
    super(
      { name: 'scoping-probe', apiKey: 'probe-key' },
      undefined,
      undefined,
      settingsService,
    );
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'probe-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const firstRead = this.resolveSettingsService().get('probe-key');
    yield {
      speaker: 'ai' as const,
      blocks: [{ type: 'text' as const, text: String(firstRead) }],
    };
    const secondRead = this.resolveSettingsService().get('probe-key');
    yield {
      speaker: 'ai' as const,
      blocks: [{ type: 'text' as const, text: String(secondRead) }],
    };
    void options;
  }
}

describe('BaseProvider concurrent call scoping', () => {
  const prompt: IContent = { speaker: 'human', blocks: [] };

  it('overlapping calls each observe their own explicit settings', async () => {
    const serviceA = new SettingsService();
    const serviceB = new SettingsService();
    serviceA.set('probe-key', 'call-A');
    serviceB.set('probe-key', 'call-B');

    const provider = new ScopingProbeProvider(serviceA);

    const optionsA = createProviderCallOptions({
      providerName: provider.name,
      contents: [prompt],
      settings: serviceA,
    });
    const optionsB = createProviderCallOptions({
      providerName: provider.name,
      contents: [prompt],
      settings: serviceB,
    });

    const iteratorA = provider.generateChatCompletion(optionsA);
    const iteratorB = provider.generateChatCompletion(optionsB);

    // Both calls are in flight simultaneously: the two first chunks are
    // requested before either generator has finished its second read.
    const [firstA, firstB] = await Promise.all([
      iteratorA.next(),
      iteratorB.next(),
    ]);

    expect(firstA.value).toMatchObject({
      blocks: [{ text: 'call-A' }],
    });
    expect(firstB.value).toMatchObject({
      blocks: [{ text: 'call-B' }],
    });

    // The interleaved second chunk proves the scope is restored per call
    // rather than set once and forgotten.
    const [secondA, secondB] = await Promise.all([
      iteratorA.next(),
      iteratorB.next(),
    ]);

    expect(secondA.value).toMatchObject({
      blocks: [{ text: 'call-A' }],
    });
    expect(secondB.value).toMatchObject({
      blocks: [{ text: 'call-B' }],
    });

    await iteratorA.return?.();
    await iteratorB.return?.();
  });
});
