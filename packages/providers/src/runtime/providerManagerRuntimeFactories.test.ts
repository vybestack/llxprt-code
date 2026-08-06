/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  Config,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '../composition/index.js';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
} from './runtimeSettings.js';

interface ConfigWithRuntimeFactories extends Config {
  getContentGeneratorFactory():
    | RuntimeContentGeneratorFactory<ProviderContentGenerator>
    | undefined;
  getTokenizerFactory(): RuntimeTokenizerFactory | undefined;
}

describe('configureProviderRuntimeFactories', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P16a
   * @requirement:REQ-DEP-001
   */
  it('injects providers-backed content generator and tokenizer factories into CLI config', async () => {
    const runtimeHandle = createIsolatedRuntimeContext({
      runtimeId: 'provider-runtime-factory-injection',
      workspaceDir: process.cwd(),
      model: 'gpt-4.1',
      metadata: { source: 'issue1584-p16a' },
      prepare: async () => {},
    });

    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
      metadata: { source: 'issue1584-p16a' },
    });

    const config = runtimeHandle.config as ConfigWithRuntimeFactories;
    const manager = runtimeHandle.providerManager;

    configureProviderRuntimeFactories(config, manager);

    const contentGeneratorFactory = config.getContentGeneratorFactory();
    const tokenizerFactory = config.getTokenizerFactory();

    expect(contentGeneratorFactory).toBeDefined();
    expect(tokenizerFactory).toBeDefined();
    expect(
      contentGeneratorFactory?.createContentGenerator(manager),
    ).toBeInstanceOf(ProviderContentGenerator);
    expect(tokenizerFactory?.getTokenizer('openai', 'gpt-4.1')).toBeDefined();
    expect(
      tokenizerFactory?.getTokenizer('anthropic', 'claude-3-5-sonnet'),
    ).toBeDefined();
  });

  /**
   * The Claude 5 registrations are only useful if the composition root
   * actually installs them, so this asserts through the composed factory
   * rather than through a locally built registry.
   */
  it('composes a separately calibrated estimator for each Claude 5 model', async () => {
    const runtimeHandle = createIsolatedRuntimeContext({
      runtimeId: 'provider-runtime-factory-claude5',
      workspaceDir: process.cwd(),
      model: 'claude-opus-5',
      metadata: { source: 'issue2835' },
      prepare: async () => {},
    });
    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
      metadata: { source: 'issue2835' },
    });
    const config = runtimeHandle.config as ConfigWithRuntimeFactories;
    configureProviderRuntimeFactories(config, runtimeHandle.providerManager);
    const tokenizerFactory = config.getTokenizerFactory();
    expect(tokenizerFactory).toBeDefined();

    expect(tokenizerFactory?.claimsModel?.('claude-opus-5')).toBe(true);
    expect(tokenizerFactory?.getEstimatorFamily?.('claude-opus-5')).toBe(
      'anthropic-claude-opus-5',
    );
    expect(tokenizerFactory?.claimsModel?.('claude-fable-5')).toBe(true);
    expect(tokenizerFactory?.getEstimatorFamily?.('claude-fable-5')).toBe(
      'anthropic-claude-fable-5',
    );

    const estimateRequest = (
      canonicalModel: string,
      activeProvider: string,
    ) => ({
      activeProvider,
      canonicalModel,
      protocol: 'anthropic-messages' as const,
      wireMethod: 'messages/v1' as const,
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3' as const,
        protocol: 'anthropic-messages' as const,
        promptText: JSON.stringify({
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'Explain tokenization.' }],
        }),
      },
      projectionRevision: 3,
      legacyEstimate: () => Promise.resolve(1234),
    });

    const opus = await tokenizerFactory!.estimatePrompt(
      estimateRequest('claude-opus-5', 'anthropic'),
    );
    expect(opus.family).toBe('anthropic-claude-opus-5');
    expect(opus.method).toBe('calibrated');
    expect(opus.count).toBeGreaterThan(0);

    const fable = await tokenizerFactory!.estimatePrompt(
      estimateRequest('claude-fable-5', 'anthropic'),
    );
    expect(fable.family).toBe('anthropic-claude-fable-5');
    expect(fable.method).toBe('calibrated');
    expect(fable.estimatorVersion).not.toBe(opus.estimatorVersion);

    const proxied = await tokenizerFactory!.estimatePrompt(
      estimateRequest('claude-opus-5', 'zai'),
    );
    expect(proxied.family).toBe('legacy-unregistered');
  });
});
