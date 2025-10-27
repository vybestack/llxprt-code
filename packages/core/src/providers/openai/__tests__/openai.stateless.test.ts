/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P08
 * @requirement REQ-SP2-001
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import OpenAI from 'openai';
import { createProviderRuntimeContext } from '../../../runtime/providerRuntimeContext.js';
import { createRuntimeConfigStub } from '../../../test-utils/runtime.js';
import type { Config } from '../../../config/config.js';

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
    svc.setProviderSetting('openai', 'baseUrl', overrides.baseUrl);
  }
  return svc;
};

beforeEach(() => {
  FakeOpenAIClass.reset();
});

describe('OpenAI provider stateless contract tests', () => {
  it('creates client per runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P08 @requirement:REQ-SP2-001 @pseudocode openai-responses-stateless.md lines 1-4', async () => {
    const provider = new TestOpenAIProvider(
      'token-A',
      'https://api.openai.com/v1',
    );
    const settingsA = createSettings({ callId: 'runtime-A' });
    const settingsB = createSettings({ callId: 'runtime-B' });
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

    const callA = provider.generateChatCompletion({
      contents: [],
      settings: settingsA,
      runtime: runtimeA,
    });
    await callA.next();

    const callB = provider.generateChatCompletion({
      contents: [],
      settings: settingsB,
      runtime: runtimeB,
    });
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
    const config = createRuntimeConfigStub(settings) as Config;
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-C',
      settingsService: settings,
      config,
    });

    await provider
      .generateChatCompletion({
        contents: [],
        settings,
        runtime,
      })
      .next();

    await provider
      .generateChatCompletion({
        contents: [],
        settings,
        runtime,
      })
      .next();

    expect(FakeOpenAIClass.created).toHaveLength(2);
    expect(FakeOpenAIClass.instances.size).toBe(2);
  });

  it('attaches per-call model parameters from runtime config @plan:PLAN-20251023-STATELESS-HARDENING.P07 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @pseudocode provider-cache-elimination.md lines 10-12', async () => {
    const provider = new TestOpenAIProvider(
      'token-runner',
      'https://api.openai.com/v1',
    );
    const settingsPrimary = createSettings({ callId: 'runtime-config' });
    const configPrimary = createRuntimeConfigStub(settingsPrimary, {
      getEphemeralSettings: () => ({
        temperature: 0.42,
        'max-tokens': 512,
      }),
    }) as Config;
    const runtimePrimary = createProviderRuntimeContext({
      runtimeId: 'runtime-config',
      settingsService: settingsPrimary,
      config: configPrimary,
    });

    await provider
      .generateChatCompletion({
        contents: [],
        settings: settingsPrimary,
        runtime: runtimePrimary,
      })
      .next();

    const firstRequest = FakeOpenAIClass.requests.at(-1)?.request;
    expect(firstRequest?.temperature).toBe(0.42);
    expect(firstRequest?.['max_tokens']).toBe(512);

    const settingsOverride = createSettings({ callId: 'runtime-config' });
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
      .generateChatCompletion({
        contents: [],
        settings: settingsOverride,
        runtime: runtimeOverride,
      })
      .next();

    const secondRequest = FakeOpenAIClass.requests.at(-1)?.request;
    expect(secondRequest?.temperature).toBe(0.85);
    expect(secondRequest?.['max_tokens']).toBe(128);
  });
});
