/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { replayableContents } from '../utils/collectContents.js';

const requestContents = replayableContents([
  { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
  { speaker: 'human', blocks: [{ type: 'text', text: 'test prompt' }] },
]);

async function* generateSecondBackendResponse(
  recordCall: () => number,
): AsyncGenerator<IContent> {
  if (recordCall() === 1) throw new Error('first backend error');
  yield { type: 'text' as const, content: 'response from second' };
}

async function* generateThirdBackendResponse(
  recordCall: () => number,
): AsyncGenerator<IContent> {
  const callCount = recordCall();
  if (callCount === 1) throw new Error('first backend error');
  if (callCount === 2) throw new Error('second backend error');
  yield { type: 'text' as const, content: 'response from third' };
}

async function* generateModelSpecificResponse(
  options: GenerateChatOptions,
  markFirstCalled: () => void,
  markSecondCalled: () => void,
): AsyncGenerator<IContent> {
  const modelId = options.resolved?.model ?? '';
  if (modelId === 'model1') {
    markFirstCalled();
    yield { type: 'text' as const, content: 'first success' };
  } else if (modelId === 'model2') {
    markSecondCalled();
    yield { type: 'text' as const, content: 'second success' };
  }
}

async function* generateCorrectFailoverResponse(
  recordCall: () => number,
): AsyncGenerator<IContent> {
  if (recordCall() === 1) throw new Error('first failed');
  yield { type: 'text' as const, content: 'correct response' };
}

async function* generateAuthIsolationResponse(
  options: GenerateChatOptions,
  recordCall: () => number,
  capturedAuthTokens: Array<string | undefined>,
): AsyncGenerator<IContent> {
  const callCount = recordCall();
  capturedAuthTokens.push(options.resolved?.authToken);
  if (callCount === 1) throw new Error('first backend error');
  yield { type: 'text' as const, content: 'success from second' };
}

function makeFailoverConfig(
  profileName: string,
  includeThird = false,
): LoadBalancingProviderConfig {
  return {
    profileName,
    strategy: 'failover',
    subProfiles: [
      {
        name: 'first',
        providerName: 'test-provider',
        modelId: 'model1',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-1',
      },
      {
        name: 'second',
        providerName: 'test-provider',
        modelId: 'model2',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-2',
      },
      ...(includeThird
        ? [
            {
              name: 'third',
              providerName: 'test-provider',
              modelId: 'model3',
              baseURL: 'https://api.test.com',
              authToken: 'test-token-3',
            },
          ]
        : []),
    ],
  };
}
function makeProviderManager(): ProviderManager {
  const settingsService = new SettingsService();
  const config = createRuntimeConfigStub(settingsService);
  return new ProviderManager({ settingsService, config });
}

describe('LoadBalancingProvider - Failover Strategy [part 1]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Strategy Selection', () => {
    it('should accept strategy: "failover" in configuration', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-failover',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'sub2',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('load-balancer');
    });

    it('accepts strategy: "round-robin" as the provider contract default', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-roundrobin',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
    });

    it('should throw error for invalid strategy value', () => {
      const lbConfig = {
        profileName: 'test-invalid',
        strategy: 'invalid-strategy',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
        ],
      } as unknown as LoadBalancingProviderConfig;

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/invalid.*strategy/i);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 2]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Strategy Selection', () => {
    it('should include both valid strategies in error message', () => {
      const lbConfig = {
        profileName: 'test-invalid',
        strategy: 'bad-strategy',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
        ],
      } as unknown as LoadBalancingProviderConfig;

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/(round-robin|failover)/i);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 3]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Sequential Execution on Errors', () => {
    it('should call first backend first', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'response from first' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig = makeFailoverConfig('test-sequential');

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'response from first',
      });
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 4]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Sequential Execution on Errors', () => {
    it('should call second backend when first fails', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        generateChatCompletion: () =>
          generateSecondBackendResponse(() => ++callCount),
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig = makeFailoverConfig('test-failover-second');

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'response from second',
      });
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 5]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Sequential Execution on Errors', () => {
    it('should call third backend when first two fail', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        generateChatCompletion: () =>
          generateThirdBackendResponse(() => ++callCount),
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig = makeFailoverConfig('test-failover-third', true);

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'response from third',
      });
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 6]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Stop-at-First-Success Behavior', () => {
    it('should return immediately when first backend succeeds', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig = makeFailoverConfig('test-stop-at-success');

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 7]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Stop-at-First-Success Behavior', () => {
    it('should not call second backend when first succeeds', async () => {
      let firstCalled = false;
      let secondCalled = false;

      const mockProvider: IProvider = {
        name: 'test-provider',
        generateChatCompletion: (options: GenerateChatOptions) =>
          generateModelSpecificResponse(
            options,
            () => {
              firstCalled = true;
            },
            () => {
              secondCalled = true;
            },
          ),
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig = makeFailoverConfig('test-no-second-call');

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(firstCalled).toBe(true);
      expect(secondCalled).toBe(false);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 8]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Stop-at-First-Success Behavior', () => {
    it('should return response from successful backend', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        generateChatCompletion: () =>
          generateCorrectFailoverResponse(() => ++callCount),
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig = makeFailoverConfig('test-correct-response');

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'correct response',
      });
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 9]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Stop-at-First-Success Behavior', () => {
    it('should NOT inherit parent resolved authToken when sub-profile omits it (issue #2132)', async () => {
      const captured: Array<{ baseURL?: string; authToken?: string }> = [];

      const mockProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          captured.push({
            baseURL: options.resolved?.baseURL,
            authToken: options.resolved?.authToken,
          });
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-no-authtoken-leak',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            // baseURL/authToken intentionally omitted
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            // baseURL/authToken intentionally omitted
          },
        ],
      };

      try {
        const provider = new LoadBalancingProvider(lbConfig, providerManager);
        const options: GenerateChatOptions = {
          contents: replayableContents([
            { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
          ]),
          resolved: {
            model: 'original-model',
            baseURL: 'https://original.api.com',
            authToken: 'original-token',
          },
        };

        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }

        expect(results).toHaveLength(1);
        // baseURL is still inherited (per design), but authToken must NOT leak
        expect(captured).toStrictEqual([
          {
            baseURL: 'https://original.api.com',
            authToken: undefined,
          },
        ]);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 10]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Stop-at-First-Success Behavior', () => {
    it('should override resolved baseURL when sub-profile provides one', async () => {
      const captured: Array<{ baseURL?: string }> = [];

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          captured.push({ baseURL: options.resolved?.baseURL });
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-override-baseurl',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://subprofile.api.com',
            authToken: 'sub-token',
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://subprofile.api.com',
            authToken: 'sub-token',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
        resolved: {
          model: 'original-model',
          baseURL: 'https://original.api.com',
          authToken: 'original-token',
        },
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(captured).toStrictEqual([
        { baseURL: 'https://subprofile.api.com' },
      ]);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 11]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Stop-at-First-Success Behavior', () => {
    it('should override resolved authToken when sub-profile provides one', async () => {
      const captured: Array<{ authToken?: string }> = [];

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          captured.push({ authToken: options.resolved?.authToken });
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-override-authtoken',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            authToken: 'subprofile-token',
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            authToken: 'subprofile-token',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        contents: requestContents,
        resolved: {
          model: 'original-model',
          baseURL: 'https://original.api.com',
          authToken: 'original-token',
        },
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(captured).toStrictEqual([{ authToken: 'subprofile-token' }]);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 12]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('AuthToken isolation on failover path (issue #2132)', () => {
    it('should NOT leak parent authToken to failover delegate when sub-profile omits it', async () => {
      let callCount = 0;
      const capturedAuthTokens: Array<string | undefined> = [];

      const mockProvider = {
        name: 'test-provider',
        generateChatCompletion: (options: GenerateChatOptions) =>
          generateAuthIsolationResponse(
            options,
            () => ++callCount,
            capturedAuthTokens,
          ),
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-failover-auth-isolation',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            // authToken intentionally omitted
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            // authToken intentionally omitted
          },
        ],
      };

      try {
        const provider = new LoadBalancingProvider(lbConfig, providerManager);
        const options: GenerateChatOptions = {
          contents: replayableContents([
            { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
          ]),
          resolved: {
            model: 'parent-model',
            authToken: 'leaked-opus-token',
          },
        };

        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }

        expect(results).toHaveLength(1);
        // Both delegates must have authToken = undefined, not the leaked parent token
        expect(capturedAuthTokens).toStrictEqual([undefined, undefined]);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
});
