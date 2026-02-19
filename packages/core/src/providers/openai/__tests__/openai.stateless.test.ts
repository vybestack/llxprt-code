/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P08
 * @requirement REQ-SP2-001
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import OpenAI from 'openai';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '../../../runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '../../../test-utils/runtime.js';
import type { Config } from '../../../config/config.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../../test-utils/providerCallOptions.js';

vi.mock('openai', () => {
  class FakeOpenAI {
    static instances: Set<symbol> = new Set();
    static created: symbol[] = [];
    static requests: Array<{ request: Record<string, unknown> }> = [];

    static reset(): void {
      FakeOpenAI.instances.clear();
      FakeOpenAI.created = [];
      FakeOpenAI.requests = [];
    }

    readonly instanceId: symbol;
    options: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      this.instanceId = Symbol('openai-client');
      FakeOpenAI.instances.add(this.instanceId);
      FakeOpenAI.created.push(this.instanceId);
      this.options = opts;
    }

    chat = {
      completions: {
        create: vi.fn(async (request: Record<string, unknown>) => {
          FakeOpenAI.requests.push({ request });
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [
                  {
                    delta: { content: 'stateless-mock-response' },
                    finish_reason: 'stop',
                    index: 0,
                  },
                ],
                usage: {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: 0,
                },
              };
            },
          };
        }),
      },
    };
  }

  return { default: FakeOpenAI };
});

const FakeOpenAIClass = OpenAI as unknown as {
  instances: Set<symbol>;
  created: symbol[];
  requests: Array<{ request: Record<string, unknown> }>;
  reset(): void;
};

class TestOpenAIProvider extends OpenAIProvider {
  private nextAuthToken = 'token-A';

  setAuthToken(token: string): void {
    this.nextAuthToken = token;
  }

  protected override async getAuthToken(): Promise<string> {
    return this.nextAuthToken;
  }
}

const createSettings = (overrides: { callId: string; baseUrl?: string }) => {
  const svc = new SettingsService();
  svc.set('call-id', overrides.callId);
  if (overrides.baseUrl) {
    svc.set('base-url', overrides.baseUrl);
    svc.setProviderSetting('openai', 'base-url', overrides.baseUrl);
  }
  return svc;
};

function buildCallOptions(
  provider: OpenAIProvider,
  overrides: Omit<ProviderCallOptionsInit, 'providerName'> = {},
) {
  const { contents = [], ...rest } = overrides;
  return createProviderCallOptions({
    providerName: provider.name,
    contents,
    ...rest,
  });
}

beforeEach(() => {
  FakeOpenAIClass.reset();
  // Set up default runtime context for tests
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'openai-stateless-test',
    }),
  );
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
});

describe('OpenAI provider stateless contract tests', () => {
  it('creates client per runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P08 @requirement:REQ-SP2-001 @pseudocode openai-responses-stateless.md lines 1-4', async () => {
    const provider = new TestOpenAIProvider(
      'token-A',
      'https://api.openai.com/v1',
    );
    const settingsA = createSettings({ callId: 'runtime-A' });
    const settingsB = createSettings({ callId: 'runtime-B' });

    const callA = provider.generateChatCompletion(
      buildCallOptions(provider, {
        settings: settingsA,
        runtimeId: 'runtime-A',
      }),
    );
    await callA.next();

    const callB = provider.generateChatCompletion(
      buildCallOptions(provider, {
        settings: settingsB,
        runtimeId: 'runtime-B',
      }),
    );
    await callB.next();

    expect(FakeOpenAIClass.created).toHaveLength(2);
    expect(FakeOpenAIClass.created[0]).not.toBe(FakeOpenAIClass.created[1]);
  });

  it('creates fresh client even within a single runtime @plan:PLAN-20251023-STATELESS-HARDENING.P09 @requirement:REQ-SP4-002', async () => {
    const provider = new TestOpenAIProvider(
      'token-A',
      'https://api.openai.com/v1',
    );
    const settings = createSettings({
      callId: 'runtime-C',
      baseUrl: 'https://api.openai.com/v1',
    });
    const firstCallOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'runtime-C',
    });
    await provider.generateChatCompletion(firstCallOptions).next();

    const secondCallOptions = buildCallOptions(provider, {
      settings,
      runtime: firstCallOptions.runtime,
      config: firstCallOptions.config,
    });
    await provider.generateChatCompletion(secondCallOptions).next();

    expect(FakeOpenAIClass.created).toHaveLength(2);
    expect(FakeOpenAIClass.instances.size).toBe(2);
  });

  it('attaches per-call model parameters from runtime config @plan:PLAN-20251023-STATELESS-HARDENING.P07 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @pseudocode provider-cache-elimination.md lines 10-12', async () => {
    const provider = new TestOpenAIProvider(
      'token-runner',
      'https://api.openai.com/v1',
    );
    const settingsPrimary = createSettings({ callId: 'runtime-config' });
    settingsPrimary.setProviderSetting('openai', 'temperature', 0.42);
    settingsPrimary.setProviderSetting('openai', 'max-tokens', 512);
    const configPrimary = createRuntimeConfigStub(settingsPrimary, {
      getEphemeralSettings: () => ({
        temperature: 0.42,
        'max-tokens': 512,
      }),
    }) as Config;
    const callOptions = buildCallOptions(provider, {
      settings: settingsPrimary,
      config: configPrimary,
      runtimeId: 'runtime-config',
    });

    await provider.generateChatCompletion(callOptions).next();

    const firstRequest = FakeOpenAIClass.requests.at(-1)?.request;
    expect(firstRequest?.temperature).toBe(0.42);
    expect(firstRequest?.['max_tokens']).toBe(512);

    const settingsOverride = createSettings({ callId: 'runtime-config' });
    settingsOverride.setProviderSetting('openai', 'temperature', 0.85);
    settingsOverride.setProviderSetting('openai', 'max-tokens', 128);
    const configOverride = createRuntimeConfigStub(settingsOverride, {
      getEphemeralSettings: () => ({
        temperature: 0.85,
        'max-tokens': 128,
      }),
    }) as Config;
    const runtimeOverride = createProviderRuntimeContext({
      runtimeId: 'runtime-config',
      settingsService: settingsOverride,
      config: configOverride,
    });

    await provider
      .generateChatCompletion(
        buildCallOptions(provider, {
          settings: settingsOverride,
          runtime: runtimeOverride,
          config: configOverride,
        }),
      )
      .next();

    const secondRequest = FakeOpenAIClass.requests.at(-1)?.request;
    expect(secondRequest?.temperature).toBe(0.85);
    expect(secondRequest?.['max_tokens']).toBe(128);
  });

  it('relies on invocation ephemerals instead of config when provided', async () => {
    const provider = new TestOpenAIProvider('token-invocation');
    const settings = createSettings({ callId: 'invocation-only' });
    const getEphemerals = vi.fn(() => {
      throw new Error('config.getEphemeralSettings should not be used');
    });
    const config = createRuntimeConfigStub(settings, {
      getEphemeralSettings: getEphemerals,
    }) as Config;
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-invocation',
      settingsService: settings,
      config,
    });
    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.17,
        streaming: 'enabled',
      },
      metadata: { testCase: 'invocation-only' },
    });

    await provider
      .generateChatCompletion(
        buildCallOptions(provider, {
          settings,
          runtime,
          config,
          invocation,
        }),
      )
      .next();

    const request = FakeOpenAIClass.requests.at(-1)?.request;
    expect(request?.temperature).toBe(0.17);
    expect(getEphemerals).not.toHaveBeenCalled();
  });

  describe('OpenAIProvider Dual-Mode Tool Call Processing', () => {
    // Helper function to access private property for testing
    function getToolCallProcessingMode(
      provider: TestOpenAIProvider,
    ): 'pipeline' | 'legacy' {
      return (
        provider as unknown as { toolCallProcessingMode: 'pipeline' | 'legacy' }
      ).toolCallProcessingMode;
    }

    it('should create provider with pipeline mode (default)', () => {
      const provider = new TestOpenAIProvider('test-key', undefined, {
        toolCallProcessingMode: 'pipeline',
      });
      expect(provider).toBeDefined();
      expect(getToolCallProcessingMode(provider)).toBe('pipeline');
    });

    it('should create provider with legacy mode', () => {
      const provider = new TestOpenAIProvider('test-key', undefined, {
        toolCallProcessingMode: 'legacy',
      });
      expect(provider).toBeDefined();
      expect(getToolCallProcessingMode(provider)).toBe('legacy');
    });

    it('should default to legacy mode when no mode specified', () => {
      const provider = new TestOpenAIProvider('test-key');
      expect(provider).toBeDefined();
      expect(getToolCallProcessingMode(provider)).toBe('legacy');
    });
  });
});
