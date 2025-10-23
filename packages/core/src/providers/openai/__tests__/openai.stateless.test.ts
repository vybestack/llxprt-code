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

    static reset(): void {
      FakeOpenAI.instances.clear();
      FakeOpenAI.created = [];
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
        create: vi.fn(async () => ({
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
        })),
      },
    };
  }

  return { default: FakeOpenAI };
});

const FakeOpenAIClass = OpenAI as unknown as {
  instances: Set<symbol>;
  created: symbol[];
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

  it('reuses client within runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P08 @requirement:REQ-SP2-001 @pseudocode openai-responses-stateless.md lines 5-8', async () => {
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

    expect(FakeOpenAIClass.created).toHaveLength(1);
    expect(FakeOpenAIClass.instances.size).toBe(1);
  });
});
