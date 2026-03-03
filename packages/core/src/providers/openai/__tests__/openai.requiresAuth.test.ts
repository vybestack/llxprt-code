import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import OpenAI from 'openai';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../../test-utils/providerCallOptions.js';

vi.mock('openai', () => {
  class FakeOpenAI {
    static created: symbol[] = [];
    static lastOptions: Record<string, unknown> | null = null;

    static reset(): void {
      FakeOpenAI.created = [];
      FakeOpenAI.lastOptions = null;
    }

    readonly instanceId: symbol;
    options: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      this.instanceId = Symbol('openai-client');
      FakeOpenAI.created.push(this.instanceId);
      this.options = opts;
      FakeOpenAI.lastOptions = opts;
    }

    chat = {
      completions: {
        create: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [
                {
                  delta: { content: 'mock-response' },
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
  created: symbol[];
  lastOptions: Record<string, unknown> | null;
  reset(): void;
};

class RequiresAuthTestProvider extends OpenAIProvider {
  protected override async getAuthToken(): Promise<string> {
    return '';
  }
}

function createSettingsWithRequiresAuth(
  baseUrl: string,
  requiresAuth?: boolean,
): SettingsService {
  const svc = new SettingsService();
  svc.set('call-id', 'requires-auth-test');
  svc.set('base-url', baseUrl);
  svc.setProviderSetting('openai', 'base-url', baseUrl);
  if (requiresAuth !== undefined) {
    svc.setProviderSetting('openai', 'requires-auth', requiresAuth);
  }
  return svc;
}

function buildCallOptions(
  provider: OpenAIProvider,
  overrides: Omit<ProviderCallOptionsInit, 'providerName'> = {},
): ReturnType<typeof createProviderCallOptions> {
  const { contents = [], ...rest } = overrides;
  return createProviderCallOptions({
    providerName: provider.name,
    contents,
    ...rest,
  });
}

beforeEach(() => {
  FakeOpenAIClass.reset();
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_BASE_URL', '');

  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'requires-auth-test',
    }),
  );
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
  vi.unstubAllEnvs();
});

describe('requires-auth setting', () => {
  it('allows connection to remote endpoint without auth when requires-auth is false', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
      false,
    );

    const callOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'no-auth-required',
    });

    const generator = provider.generateChatCompletion(callOptions);
    await expect(generator.next()).resolves.toBeDefined();
    expect(FakeOpenAIClass.created).toHaveLength(1);
  });

  it('throws auth error for remote endpoint without auth when requires-auth is not set', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
    );

    const callOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'auth-required-default',
    });

    const generator = provider.generateChatCompletion(callOptions);
    await expect(generator.next()).rejects.toThrow('REQ-SP4-003');
  });

  it('throws auth error for remote endpoint without auth when requires-auth is true', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
      true,
    );

    const callOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'auth-required-explicit',
    });

    const generator = provider.generateChatCompletion(callOptions);
    await expect(generator.next()).rejects.toThrow('REQ-SP4-003');
  });
});
