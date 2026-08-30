/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  conservativeMediaTransportCapabilities,
  declaredMediaTransportCapabilities,
} from './providerMediaTransportCapabilities.js';
import { ProviderCapabilitiesService } from './providerCapabilitiesService.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createOpenAIAliasProvider } from './composition/aliasProviderFactory.js';
import type { ProviderAliasEntry } from './composition/providerAliases.js';

describe('provider media transport capabilities', () => {
  it('uses exact stateless replay without remote storage or assumed caching for unknown providers', () => {
    const capabilities = declaredMediaTransportCapabilities('unknown-provider');

    expect(capabilities).toStrictEqual(
      conservativeMediaTransportCapabilities(),
    );
    expect(capabilities.statelessFullReplay).toBe(true);
    expect(capabilities.durableStoredContinuation).toBe(false);
    expect(capabilities.transportScopedContinuation).toBe(false);
    expect(capabilities.providerFileReferences).toBe(false);
    expect(capabilities.remoteFileRetention).toBe('none');
    expect(capabilities.zeroDataRetention).toBe('not-applicable');
    expect(capabilities.explicitCacheBreakpoints).toBe(false);
    expect(capabilities.automaticPrefixCaching).toBe(false);
    expect(capabilities.cacheAffinityKey).toBe(false);
  });

  it('declares independent durable and transport-scoped continuation modes', () => {
    const responses = declaredMediaTransportCapabilities('openai-responses');
    const codex = declaredMediaTransportCapabilities('codex');

    expect(responses.durableStoredContinuation).toBe(true);
    expect(responses.transportScopedContinuation).toBe(false);
    expect(codex.durableStoredContinuation).toBe(false);
    expect(codex.transportScopedContinuation).toBe(true);
    expect(responses.statelessFullReplay).toBe(true);
    expect(codex.statelessFullReplay).toBe(true);
    expect(responses.streamingRequestBody).toBe(true);
    expect(codex.streamingRequestBody).toBe(false);
  });

  it('does not couple cache, file-reference, retention, and body-streaming declarations', () => {
    const anthropic = declaredMediaTransportCapabilities('anthropic');
    const kimi = declaredMediaTransportCapabilities('kimi');
    const automaticCacheProvider = declaredMediaTransportCapabilities('gemini');

    expect(anthropic.explicitCacheBreakpoints).toBe(true);
    expect(anthropic.cacheAffinityKey).toBe(false);
    expect(anthropic.providerFileReferences).toBe(false);
    expect(anthropic.streamingRequestBody).toBe(true);
    expect(kimi.explicitCacheBreakpoints).toBe(false);
    expect(kimi.automaticPrefixCaching).toBe(true);
    expect(kimi.cacheAffinityKey).toBe(true);
    expect(kimi.providerFileReferences).toBe(true);
    expect(kimi.remoteFileRetention).toBe('provider-retained');
    expect(kimi.zeroDataRetention).toBe('incompatible-while-retained');
    expect(automaticCacheProvider.automaticPrefixCaching).toBe(true);
    expect(automaticCacheProvider.streamingRequestBody).toBe(false);
  });

  it('uses registered alias metadata instead of inferring capabilities from the provider name', () => {
    const entry = {
      alias: 'custom-media-adapter',
      filePath: '/registered/custom-media-adapter.config',
      source: 'builtin',
      config: {
        baseProvider: 'openai',
        'base-url': 'https://example.test/v1',
        mediaTransportCapabilities: {
          durableStoredContinuation: false,
          transportScopedContinuation: true,
          statelessFullReplay: true,
          explicitCacheBreakpoints: false,
          automaticPrefixCaching: false,
          cacheAffinityKey: true,
          providerFileReferences: false,
          remoteFileRetention: 'none',
          zeroDataRetention: 'not-applicable',
          streamingRequestBody: false,
        },
      },
    } satisfies ProviderAliasEntry;

    const provider = createOpenAIAliasProvider(
      entry,
      'test-key',
      undefined,
      {},
    );

    expect(provider.getMediaTransportCapabilities()).toStrictEqual(
      entry.config.mediaTransportCapabilities,
    );
  });

  it('keeps provider-name lookalikes on exact replay with no remote storage', () => {
    const entry = {
      alias: 'kimi-compatible-without-metadata',
      filePath: '/registered/kimi-compatible-without-metadata.config',
      source: 'builtin',
      config: {
        baseProvider: 'openai',
        'base-url': 'https://example.test/v1',
      },
    } satisfies ProviderAliasEntry;

    const provider = createOpenAIAliasProvider(
      entry,
      'test-key',
      undefined,
      {},
    );

    expect(provider.getMediaTransportCapabilities()).toStrictEqual(
      conservativeMediaTransportCapabilities(),
    );
  });

  it('returns capability snapshots that cannot mutate registered metadata', () => {
    const provider = new OpenAIProvider('test-key');
    const first = provider.getMediaTransportCapabilities();

    Reflect.set(first, 'providerFileReferences', true);

    expect(
      provider.getMediaTransportCapabilities().providerFileReferences,
    ).toBe(false);
  });

  it('captures an adapter declaration at the existing provider capability seam', () => {
    const provider = new OpenAIProvider('test-key');
    const service = new ProviderCapabilitiesService(new Map());

    const captured = service.captureProviderCapabilities(
      provider,
      new SettingsService(),
    );

    expect(captured.mediaTransport).toStrictEqual({
      durableStoredContinuation: false,
      transportScopedContinuation: false,
      statelessFullReplay: true,
      explicitCacheBreakpoints: false,
      automaticPrefixCaching: true,
      cacheAffinityKey: true,
      providerFileReferences: false,
      remoteFileRetention: 'none',
      zeroDataRetention: 'not-applicable',
      streamingRequestBody: true,
    });
  });
});
