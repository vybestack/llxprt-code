/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type {
  Config,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
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
});
