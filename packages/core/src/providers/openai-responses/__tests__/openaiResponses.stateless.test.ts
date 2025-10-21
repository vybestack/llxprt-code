/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P08
 * @requirement REQ-SP2-001
 */
import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { createProviderRuntimeContext } from '../../../runtime/providerRuntimeContext.js';

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    readonly options: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      this.options = opts;
    }

    responses = {
      create: vi.fn(async () => ({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: 'response',
              },
            ],
          },
        ],
      })),
    };
  },
}));

class TestResponsesProvider extends OpenAIResponsesProvider {
  private readonly cacheSizes: number[] = [];

  getCacheSizes() {
    return this.cacheSizes.slice();
  }

  protected override async *generateChatCompletionWithOptions(
    options: Parameters<
      OpenAIResponsesProvider['generateChatCompletionWithOptions']
    >[0],
  ): AsyncGenerator<unknown> {
    void options;
    this.cacheSizes.push(this.getConversationCache().size());
    yield { speaker: 'ai', blocks: [] };
  }
}

const createSettings = (conversationId: string, parentId: string) => {
  const svc = new SettingsService();
  svc.setProviderSetting('openai-responses', 'conversationId', conversationId);
  svc.setProviderSetting('openai-responses', 'parentId', parentId);
  svc.setProviderSetting('openai-responses', 'model', 'o3-mini');
  return svc;
};

describe('OpenAI Responses provider stateless contract tests', () => {
  it('clears conversation cache per call @plan:PLAN-20251018-STATELESSPROVIDER2.P08 @requirement:REQ-SP2-001 @pseudocode openai-responses-stateless.md lines 6-8', async () => {
    const provider = new TestResponsesProvider(
      'token-A',
      'https://api.openai.com/v1',
    );
    const settingsA = createSettings('conversation-A', 'parent-1');
    const settingsB = createSettings('conversation-B', 'parent-2');
    const runtimeA = createProviderRuntimeContext({
      runtimeId: 'runtime-A',
      settingsService: settingsA,
    });
    const runtimeB = createProviderRuntimeContext({
      runtimeId: 'runtime-B',
      settingsService: settingsB,
    });

    await provider
      .generateChatCompletion({
        contents: [],
        settings: settingsA,
        runtime: runtimeA,
      })
      .next();
    await provider
      .generateChatCompletion({
        contents: [],
        settings: settingsB,
        runtime: runtimeB,
      })
      .next();

    const sizes = provider.getCacheSizes();
    expect(sizes).toEqual([0, 0]);
  });
});
