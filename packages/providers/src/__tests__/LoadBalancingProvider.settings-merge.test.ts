/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('LoadBalancingProvider', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  afterEach(() => {
    // Clean up any registered providers
  });

  describe('Phase 3c: Round-Robin with ResolvedSubProfile and Settings Merge', () => {
    describe('round-robin with ResolvedSubProfile', () => {
      it('should cycle through ResolvedSubProfiles on each request', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'resolved-sub-1',
            providerName: 'gemini',
            model: 'gemini-flash',
            baseURL: 'https://api1.example.com',
            authToken: 'token-1',
            ephemeralSettings: { temperature: 0.5 },
            modelParams: { maxTokens: 100 },
          },
          {
            name: 'resolved-sub-2',
            providerName: 'gemini',
            model: 'gemini-pro',
            baseURL: 'https://api2.example.com',
            authToken: 'token-2',
            ephemeralSettings: { temperature: 0.7 },
            modelParams: { maxTokens: 200 },
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'resolved-round-robin-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selectionOrder: string[] = [];
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        const originalSelectNext = (
          provider as unknown as {
            selectNextSubProfile: () => ResolvedSubProfile;
          }
        ).selectNextSubProfile.bind(provider);

        (
          provider as unknown as {
            selectNextSubProfile: () => ResolvedSubProfile;
          }
        ).selectNextSubProfile = () => {
          const selected = originalSelectNext();
          selectionOrder.push(selected.name);
          return selected;
        };

        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 4 requests to verify round-robin cycling
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          expect(selectionOrder).toStrictEqual([
            'resolved-sub-1',
            'resolved-sub-2',
            'resolved-sub-1',
            'resolved-sub-2',
          ]);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('sub-profile settings are not overridden', () => {
      it('should use sub-profile provider, model, and auth settings', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'custom-sub',
            providerName: 'gemini',
            model: 'custom-model-xyz',
            baseURL: 'https://custom.api.example.com',
            authToken: 'custom-auth-token-abc',
            ephemeralSettings: { temperature: 0.9 },
            modelParams: { topP: 0.95 },
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'sub-profile-settings-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          expect(capturedOptions!.resolved!.model).toBe('custom-model-xyz');
          expect(capturedOptions!.resolved!.baseURL).toBe(
            'https://custom.api.example.com',
          );
          expect(capturedOptions!.resolved!.authToken).toBe(
            'custom-auth-token-abc',
          );
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should preserve sub-profile modelParams', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'params-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {},
            modelParams: {
              maxTokens: 500,
              topP: 0.9,
              topK: 40,
              stopSequences: ['END'],
            },
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'model-params-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify modelParams are in metadata
          expect(capturedOptions!.metadata?.modelParams).toStrictEqual({
            maxTokens: 500,
            topP: 0.9,
            topK: 40,
            stopSequences: ['END'],
          });
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should surface modelParams and reasoning settings through delegate runtime invocation', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'reasoning-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {
              'reasoning.enabled': true,
              'reasoning.budgetTokens': 2048,
            },
            modelParams: {
              topP: 0.9,
            },
          },
        ];

        const provider = new LoadBalancingProvider(
          {
            profileName: 'reasoning-test',
            strategy: 'round-robin',
            subProfiles: resolvedSubProfiles,
            lbProfileModelParams: { topK: 40 },
          },
          providerManager,
        );

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            settings: settingsService,
            config,
            runtime: { settingsService, config },
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(
            capturedOptions?.invocation?.getModelBehavior('reasoning.enabled'),
          ).toBe(true);
          expect(
            capturedOptions?.invocation?.getModelBehavior(
              'reasoning.budgetTokens',
            ),
          ).toBe(2048);
          expect(capturedOptions?.invocation?.modelParams).toMatchObject({
            topP: 0.9,
            topK: 40,
          });
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('issue #2182: cross-provider ephemerals must not leak into modelParams', () => {
      it('does not surface a nested text object or streamIdleTimeoutMs on the delegate invocation', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'opusthinking',
            providerName: 'anthropic',
            model: 'claude-opus-4-8',
            ephemeralSettings: {
              'reasoning.enabled': true,
              'reasoning.effort': 'xhigh',
            },
            modelParams: {},
          },
          {
            name: 'gpt55high',
            providerName: 'codex',
            model: 'gpt-5.5',
            ephemeralSettings: {
              'reasoning.enabled': true,
              'reasoning.effort': 'high',
              'text.verbosity': 'medium',
            },
            modelParams: {},
          },
        ];

        const provider = new LoadBalancingProvider(
          {
            profileName: 'opusfirst',
            strategy: 'failover',
            subProfiles: resolvedSubProfiles,
            // LB-level nested object + the global camelCase setting from
            // settings.json that previously leaked verbatim into the body.
            lbProfileEphemeralSettings: {
              reasoning: { enabled: true, effort: 'high' },
              text: { verbosity: 'medium' },
              'prompt-caching': '24h',
              streamIdleTimeoutMs: 60000,
            },
          },
          providerManager,
        );

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'anthropic',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'claude-opus-4-8',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            settings: settingsService,
            config,
            runtime: { settingsService, config },
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions?.invocation?.modelParams).toBeDefined();
          const modelParams = capturedOptions!.invocation!
            .modelParams as Record<string, unknown>;
          expect(modelParams['text']).toBeUndefined();
          expect(modelParams['text.verbosity']).toBeUndefined();
          expect(modelParams['streamIdleTimeoutMs']).toBeUndefined();
          expect(modelParams['stream_idle_timeout_ms']).toBeUndefined();
          expect(modelParams['reasoning']).toBeUndefined();
          // text.verbosity survives as model-behavior, not a raw model-param.
          expect(
            capturedOptions?.invocation?.getModelBehavior('text.verbosity'),
          ).toBe('medium');
          expect(
            capturedOptions?.invocation?.getCliSetting(
              'stream-idle-timeout-ms',
            ),
          ).toBe(60000);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });
    describe('ephemeralSettings merge (dumb merge)', () => {
      it('should merge LB profile ephemeralSettings over sub-profile ephemeralSettings', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'merge-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {
              temperature: 0.5,
              topP: 0.8,
              maxTokens: 100,
            },
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'merge-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
          lbProfileEphemeralSettings: {
            temperature: 0.9,
            maxTokens: 500,
          },
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify merged ephemeralSettings are in metadata
          expect(capturedOptions!.metadata?.ephemeralSettings).toStrictEqual({
            temperature: 0.9,
            topP: 0.8,
            maxTokens: 500,
          });
          // Verify individual settings are mapped to resolved
          expect(capturedOptions!.resolved!.temperature).toBe(0.9);
          expect(capturedOptions!.resolved!.maxTokens).toBe(500);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should preserve sub-profile ephemeralSettings when LB profile has none', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'no-override-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {
              temperature: 0.7,
              maxTokens: 300,
            },
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'no-override-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify sub-profile ephemeralSettings are in metadata
          expect(capturedOptions!.metadata?.ephemeralSettings).toStrictEqual({
            temperature: 0.7,
            maxTokens: 300,
          });
          // Verify individual settings are mapped to resolved
          expect(capturedOptions!.resolved!.temperature).toBe(0.7);
          expect(capturedOptions!.resolved!.maxTokens).toBe(300);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should use LB profile ephemeralSettings when sub-profile has empty settings', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'empty-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {},
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'lb-only-settings-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
          lbProfileEphemeralSettings: {
            temperature: 0.8,
            topK: 50,
          },
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify LB profile ephemeralSettings are in metadata
          expect(capturedOptions!.metadata?.ephemeralSettings).toStrictEqual({
            temperature: 0.8,
            topK: 50,
          });
          // Verify individual settings that map to resolved are there
          expect(capturedOptions!.resolved!.temperature).toBe(0.8);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('isolated auth per sub-profile', () => {
      it('should use different auth tokens for different sub-profiles', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'account-1-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            authToken: 'account-1-token',
            ephemeralSettings: {},
            modelParams: {},
          },
          {
            name: 'account-2-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            authToken: 'account-2-token',
            ephemeralSettings: {},
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'isolated-auth-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const capturedAuthTokens: string[] = [];
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            if (options.resolved?.authToken != null) {
              capturedAuthTokens.push(options.resolved.authToken);
            }
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 4 requests to cycle through both auth tokens twice
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          expect(capturedAuthTokens).toStrictEqual([
            'account-1-token',
            'account-2-token',
            'account-1-token',
            'account-2-token',
          ]);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should use different baseURLs for different sub-profiles', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'endpoint-1-sub',
            providerName: 'openai',
            model: 'gpt-4',
            baseURL: 'https://endpoint1.example.com',
            ephemeralSettings: {},
            modelParams: {},
          },
          {
            name: 'endpoint-2-sub',
            providerName: 'openai',
            model: 'gpt-4',
            baseURL: 'https://endpoint2.example.com',
            ephemeralSettings: {},
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'isolated-baseurl-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const capturedBaseURLs: string[] = [];
        const mockProvider = {
          name: 'openai',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            if (options.resolved?.baseURL != null) {
              capturedBaseURLs.push(options.resolved.baseURL);
            }
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gpt-4',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          expect(capturedBaseURLs).toStrictEqual([
            'https://endpoint1.example.com',
            'https://endpoint2.example.com',
            'https://endpoint1.example.com',
            'https://endpoint2.example.com',
          ]);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });
  });
});
