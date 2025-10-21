/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P11
 * @requirement REQ-SP2-001
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { createProviderRuntimeContext } from '../../../runtime/providerRuntimeContext.js';
import { AnthropicProvider } from '../AnthropicProvider.js';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    static created: Array<{
      instanceId: symbol;
      options: Record<string, unknown>;
    }> = [];

    static requests: Array<{
      request: unknown;
    }> = [];

    static reset(): void {
      FakeAnthropic.created = [];
      FakeAnthropic.requests = [];
    }

    readonly instanceId: symbol;
    readonly options: Record<string, unknown>;
    readonly messages: {
      create: ReturnType<typeof vi.fn>;
    };

    constructor(opts: Record<string, unknown>) {
      this.instanceId = Symbol('anthropic-client');
      this.options = opts;
      FakeAnthropic.created.push({
        instanceId: this.instanceId,
        options: opts,
      });
      this.messages = {
        create: vi.fn(async (request: unknown) => {
          FakeAnthropic.requests.push({ request });
          return {
            content: [
              {
                type: 'text',
                text: 'ok',
              },
            ],
            usage: {
              input_tokens: 0,
              output_tokens: 0,
            },
          };
        }),
      };
    }
  }

  return { default: FakeAnthropic };
});

const FakeAnthropicClass = Anthropic as unknown as {
  created: Array<{
    instanceId: symbol;
    options: Record<string, unknown>;
  }>;
  requests: Array<{
    request: unknown;
  }>;
  reset(): void;
};

class TestAnthropicProvider extends AnthropicProvider {
  private nextAuthToken = 'token-A';

  constructor() {
    super(undefined, 'https://api.anthropic.com', {
      getEphemeralSettings: () => ({ streaming: 'disabled' }),
    });
  }

  setAuthToken(token: string): void {
    this.nextAuthToken = token;
  }

  protected override async getAuthToken(): Promise<string> {
    return this.nextAuthToken;
  }
}

const createSettings = (runtimeId: string): SettingsService => {
  const svc = new SettingsService();
  svc.set('call-id', runtimeId);
  return svc;
};

beforeEach(() => {
  FakeAnthropicClass.reset();
});

describe('Anthropic provider stateless contract tests', () => {
  it('scopes client cache by runtime id @plan:PLAN-20251018-STATELESSPROVIDER2.P11 @requirement:REQ-SP2-001 @pseudocode anthropic-gemini-stateless.md lines 1-3', async () => {
    const provider = new TestAnthropicProvider();
    const baselineInstances = FakeAnthropicClass.created.length;
    const settingsA = createSettings('runtime-A');
    const settingsB = createSettings('runtime-B');
    const runtimeA = createProviderRuntimeContext({
      runtimeId: 'runtime-A',
      settingsService: settingsA,
    });
    const runtimeB = createProviderRuntimeContext({
      runtimeId: 'runtime-B',
      settingsService: settingsB,
    });

    provider.setAuthToken('sk-shared-token');

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

    const runtimeClients = FakeAnthropicClass.created.slice(baselineInstances);

    expect(runtimeClients).toHaveLength(2);
    expect(runtimeClients[0].instanceId).not.toBe(runtimeClients[1].instanceId);
  });

  it('reuses cached client for returning runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P11 @requirement:REQ-SP2-001 @pseudocode anthropic-gemini-stateless.md lines 2-4', async () => {
    const provider = new TestAnthropicProvider();
    const baselineInstances = FakeAnthropicClass.created.length;
    const settingsA = createSettings('runtime-A');
    const settingsB = createSettings('runtime-B');
    const runtimeA = createProviderRuntimeContext({
      runtimeId: 'runtime-A',
      settingsService: settingsA,
    });
    const runtimeB = createProviderRuntimeContext({
      runtimeId: 'runtime-B',
      settingsService: settingsB,
    });

    provider.setAuthToken('token-A');
    await provider
      .generateChatCompletion({
        contents: [],
        settings: settingsA,
        runtime: runtimeA,
      })
      .next();

    provider.setAuthToken('token-B');
    await provider
      .generateChatCompletion({
        contents: [],
        settings: settingsB,
        runtime: runtimeB,
      })
      .next();

    provider.setAuthToken('token-A');
    await provider
      .generateChatCompletion({
        contents: [],
        settings: settingsA,
        runtime: runtimeA,
      })
      .next();

    const runtimeClients = FakeAnthropicClass.created.slice(baselineInstances);

    expect(runtimeClients).toHaveLength(2);
    expect(runtimeClients[0].options.apiKey).toBe('token-A');
    expect(runtimeClients[1].options.apiKey).toBe('token-B');
  });
});
