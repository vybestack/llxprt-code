import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

const messagesCreateCalls: string[] = [];

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((config: Record<string, unknown>) => {
    const token =
      (typeof config.authToken === 'string' && config.authToken) ||
      (typeof config.apiKey === 'string' && config.apiKey) ||
      '';
    return {
      messages: {
        create: vi.fn(async () => {
          messagesCreateCalls.push(token);
          if (token.includes('bucket1')) {
            throw Object.assign(new Error('Too Many Requests'), {
              status: 429,
            });
          }
          return {
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }),
      },
    };
  }),
}));

describe('AnthropicProvider bucket failover integration', () => {
  beforeEach(() => {
    messagesCreateCalls.length = 0;
  });

  it('retries with a new bucket token after persistent 429s', async () => {
    let activeBucket = 'bucket1';

    const oauthManager = {
      getToken: vi.fn(async () => `sk-ant-oat-${activeBucket}`),
      isAuthenticated: vi.fn(async () => true),
    };

    const failoverHandler = {
      getBuckets: () => ['bucket1', 'bucket2'],
      getCurrentBucket: () => activeBucket,
      isEnabled: () => true,
      reset: () => {
        activeBucket = 'bucket1';
      },
      tryFailover: vi.fn(async () => {
        if (activeBucket === 'bucket1') {
          activeBucket = 'bucket2';
          return true;
        }
        return false;
      }),
    };

    const provider = new AnthropicProvider(
      undefined,
      undefined,
      undefined,
      oauthManager as never,
    );

    const options = createProviderCallOptions({
      providerName: 'anthropic',
      runtimeId: 'anthropic.failover.test',
      settingsOverrides: {
        global: {
          retries: 4,
          retrywait: 0,
          streaming: 'disabled',
        },
        provider: {
          streaming: 'disabled',
        },
      },
      configOverrides: {
        getBucketFailoverHandler: () => failoverHandler,
      },
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hi' }],
        },
      ],
    });

    const iterator = provider.generateChatCompletion(options);
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(messagesCreateCalls.some((token) => token.includes('bucket2'))).toBe(
      true,
    );
  });
});
