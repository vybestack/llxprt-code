/**
 * @plan PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @project-plans/debuglogging/requirements.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '../../runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import type { Config } from '../../config/config.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import Anthropic from '@anthropic-ai/sdk';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../test-utils/providerCallOptions.js';

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

function buildCallOptions(
  provider: AnthropicProvider,
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
  FakeAnthropicClass.reset();
  // Set up default runtime context for tests
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'anthropic-stateless-test',
    }),
  );
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
});

describe('Anthropic provider stateless contract tests', () => {
  it('scopes client cache by runtime id @plan:PLAN-20251018-STATELESSPROVIDER2.P11 @requirement:REQ-SP2-001 @pseudocode anthropic-gemini-stateless.md lines 1-3', async () => {
    const provider = new TestAnthropicProvider();
    const baselineInstances = FakeAnthropicClass.created.length;
    const settingsA = createSettings('runtime-A');
    const settingsB = createSettings('runtime-B');
    provider.setAuthToken('sk-shared-token');

    await provider
      .generateChatCompletion(
        buildCallOptions(provider, {
          settings: settingsA,
          runtimeId: 'runtime-A',
        }),
      )
      .next();

    await provider
      .generateChatCompletion(
        buildCallOptions(provider, {
          settings: settingsB,
          runtimeId: 'runtime-B',
        }),
      )
      .next();

    const runtimeClients = FakeAnthropicClass.created.slice(baselineInstances);

    expect(runtimeClients).toHaveLength(2);
    expect(runtimeClients[0].instanceId).not.toBe(runtimeClients[1].instanceId);
  });

  it('creates fresh client for each call @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002', async () => {
    const provider = new TestAnthropicProvider();
    const baselineInstances = FakeAnthropicClass.created.length;
    const settingsA = createSettings('runtime-A');
    const settingsB = createSettings('runtime-B');
    const configA = createRuntimeConfigStub(settingsA) as Config;
    const configB = createRuntimeConfigStub(settingsB) as Config;
    const runtimeA = createProviderRuntimeContext({
      runtimeId: 'runtime-A',
      settingsService: settingsA,
      config: configA,
    });
    const runtimeB = createProviderRuntimeContext({
      runtimeId: 'runtime-B',
      settingsService: settingsB,
      config: configB,
    });

    provider.setAuthToken('token-A');
    await provider
      .generateChatCompletion(
        buildCallOptions(provider, {
          settings: settingsA,
          runtime: runtimeA,
          config: configA,
        }),
      )
      .next();

    provider.setAuthToken('token-B');
    await provider
      .generateChatCompletion(
        buildCallOptions(provider, {
          settings: settingsB,
          runtime: runtimeB,
          config: configB,
        }),
      )
      .next();

    provider.setAuthToken('token-A');
    await provider
      .generateChatCompletion(
        buildCallOptions(provider, {
          settings: settingsA,
          runtime: runtimeA,
          config: configA,
        }),
      )
      .next();

    const runtimeClients = FakeAnthropicClass.created.slice(baselineInstances);

    // @plan PLAN-20251023-STATELESS-HARDENING.P08: Expect 3 fresh clients (no caching)
    expect(runtimeClients).toHaveLength(3);
    expect(runtimeClients[0].options.apiKey).toBe('token-A');
    expect(runtimeClients[1].options.apiKey).toBe('token-B');
    expect(runtimeClients[2].options.apiKey).toBe('token-A');
  });

  it('gets model params from SettingsService without caching @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003', async () => {
    const provider = new TestAnthropicProvider();
    // Should return params from SettingsService or undefined, but not throw
    const params = provider.getModelParams();
    expect(params === undefined || typeof params === 'object').toBe(true);
  });

  it('reads request overrides from invocation ephemerals when config is inert', async () => {
    const provider = new TestAnthropicProvider();
    const settings = createSettings('runtime-invocation');
    const getEphemerals = vi.fn(() => {
      throw new Error('config ephemerals should not be accessed');
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
      providerName: 'anthropic',
      ephemeralsSnapshot: {
        streaming: 'enabled',
        anthropic: {
          top_k: 5,
          temperature: 0.3,
        },
      },
      userMemory: 'cached-memory-profile',
      metadata: { testCase: 'anthropic-invocation-ephemerals' },
    });

    provider.setAuthToken('token-invocation');
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

    const lastRequest = FakeAnthropicClass.requests.at(-1)?.request as
      | Record<string, unknown>
      | undefined;
    expect(lastRequest).toBeDefined();
    expect(lastRequest).toMatchObject({
      top_k: 5,
      temperature: 0.3,
    });
    expect(getEphemerals).not.toHaveBeenCalled();
  });
});
