import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '../OpenAIProvider.js';
import OpenAI from 'openai';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

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

const FakeOpenAIClass = FakeOpenAI;
const constructFakeClient = (
  options: ConstructorParameters<typeof OpenAI>[0],
): OpenAI =>
  new FakeOpenAI(
    options as unknown as Record<string, unknown>,
  ) as unknown as OpenAI;

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

const originalApiKey = process.env.OPENAI_API_KEY;
const originalBaseUrl = process.env.OPENAI_BASE_URL;

describe('requires-auth setting', () => {
  beforeEach(() => {
    FakeOpenAIClass.reset();
    process.env.OPENAI_API_KEY = '';
    process.env.OPENAI_BASE_URL = '';

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'requires-auth-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBaseUrl;
  });

  it('allows connection to remote endpoint without auth when requires-auth is false', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
      undefined,
      { constructClient: constructFakeClient },
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
    expect(await generator.next()).toBeDefined();
    expect(FakeOpenAIClass.created).toHaveLength(1);
  });

  it('throws auth error for remote endpoint without auth when requires-auth is not set', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
      undefined,
      { constructClient: constructFakeClient },
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
      undefined,
      { constructClient: constructFakeClient },
    );

    const callOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'auth-required-default',
    });

    const generator = provider.generateChatCompletion(callOptions);
    expect(generator.next()).rejects.toThrow('REQ-SP4-003');
  });

  it('throws auth error for remote endpoint without auth when requires-auth is true', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
      undefined,
      { constructClient: constructFakeClient },
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
    expect(generator.next()).rejects.toThrow('REQ-SP4-003');
  });
});
