import { describe, expect, it } from 'bun:test';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

class HarnessProvider extends BaseProvider {
  lastNormalizedOptions: NormalizedGenerateChatOptions | undefined;

  constructor() {
    super({ name: 'harness' });
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'harness-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastNormalizedOptions = options;
    return (async function* () {})();
  }
}

describe('BaseProvider admission guard', () => {
  const prompt: IContent = { speaker: 'human', blocks: [] };
  it('admits standalone calls with owner defaults without forwarding settings', async () => {
    const provider = new HarnessProvider();
    await provider.generateChatCompletion({ contents: [prompt] }).next();
    expect(provider.lastNormalizedOptions?.resolved.model).toBe(
      'harness-model',
    );
    expect(provider.lastNormalizedOptions).not.toHaveProperty('settings');
    expect(provider.lastNormalizedOptions).not.toHaveProperty('runtime');
  });
  it('rejects an empty admitted model before the provider starts', async () => {
    const provider = new HarnessProvider();
    await expect(
      provider
        .generateChatCompletion({ contents: [prompt], resolved: { model: '' } })
        .next(),
    ).rejects.toMatchObject({
      name: 'MissingProviderRuntimeError',
      missingFields: expect.arrayContaining(['resolved.model']),
    });
    expect(provider.lastNormalizedOptions).toBeUndefined();
  });
});
