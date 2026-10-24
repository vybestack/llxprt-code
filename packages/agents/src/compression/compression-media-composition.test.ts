import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { describe, expect, it } from 'bun:test';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createHistoryProviderFileBindingStore } from '@vybestack/llxprt-code-core/services/history/provider-file-binding.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import {
  buildContext,
  generateHistory,
  testProviderRuntime,
} from './__tests__/MiddleOutStrategy-test-helpers.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

describe('compression media composition', () => {
  for (const Strategy of [MiddleOutStrategy, OneShotStrategy]) {
    it(`${Strategy.name} uses selected collaborators for summary and verification`, async () => {
      const resolver = new RequestMediaResolver(
        new LocalMediaStore({
          rootDirectory: '/unused/compression-media',
          quotaBytes: 1024,
        }),
      );
      const bindings = createHistoryProviderFileBindingStore(
        new HistoryService(),
      );
      const lifecycle = {};
      const selectedConfig = createRuntimeConfigStub(new SettingsService());
      let completedRequests = 0;
      const requestDirectories: Array<string | undefined> = [];
      const provider: RuntimeProvider & {
        requestMediaResolver?: RequestMediaResolver;
        requestMediaBudgetBytes?: number;
        requestProviderFileBindings?: ProviderFileBindingStore;
        requestProviderFileLifecycle?: object;
        requestWorkspaceDirectory?: string;
      } = {
        requestMediaResolver: undefined,
        requestMediaBudgetBytes: undefined,
        requestProviderFileBindings: undefined,
        requestProviderFileLifecycle: undefined,
        name: 'composition-provider',
        getDefaultModel: () => 'test-model',
        getModels: async () => [],
        async *generateChatCompletion(
          options: RuntimeGenerateChatOptions | IContent[],
        ): AsyncIterableIterator<IContent> {
          if (Array.isArray(options))
            throw new Error('Expected compression options');
          if (
            this.requestMediaResolver !== resolver ||
            this.requestMediaBudgetBytes !== 1024 ||
            this.requestProviderFileBindings !== bindings ||
            this.requestProviderFileLifecycle !== lifecycle
          )
            throw new Error('Compression admitted foreign media/file owners');
          completedRequests += 1;
          requestDirectories.push(this.requestWorkspaceDirectory);
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: '<state_snapshot>Summary</state_snapshot>',
              },
            ],
          };
        },
      };
      const context = buildContext({
        history: generateHistory(20),
        resolveProvider: () => ({
          provider,
          runtime: testProviderRuntime,
          config: selectedConfig,
          invocation: captureProviderInvocation(
            {
              fetch: requestFetch,
              runtimeId: testProviderRuntime.runtimeId,
              globalSettings: new SettingsService().getAllGlobalSettings(),
              providerSettings: new SettingsService().getProviderSettings(
                provider.name,
              ),
            },
            provider.name,
          ),
        }),
      });
      try {
        const result = await new Strategy(
          resolver,
          1024,
          bindings,
          lifecycle,
        ).compress({ ...context, compressionVerification: true });
        expect({ kind: result.kind, completedRequests }).toStrictEqual({
          kind: 'applied',
          completedRequests: 2,
        });
        expect(requestDirectories).toStrictEqual([
          selectedConfig.getTargetDir(),
          selectedConfig.getTargetDir(),
        ]);
      } finally {
        await selectedConfig.dispose();
      }
    });
  }
});
