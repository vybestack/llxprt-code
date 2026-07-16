/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the neutral bootstrap identity (#2481).
 *
 * Verifies that createAgentRuntimeStateFromConfig returns UNCONFIGURED_PROVIDER
 * and PLACEHOLDER_MODEL (not Gemini defaults) when no provider/model is present.
 * Explicit provider/model configuration is still preserved.
 */

import { describe, it, expect } from 'vitest';
import { createAgentRuntimeStateFromConfig } from './runtimeStateFactory.js';
import type { RuntimeStateConfigSource } from './runtimeStateFactory.js';
import { PLACEHOLDER_MODEL, UNCONFIGURED_PROVIDER } from '../config/models.js';

describe('createAgentRuntimeStateFromConfig: neutral bootstrap identity (#2481)', () => {
  it('returns full neutral pair (UNCONFIGURED_PROVIDER + PLACEHOLDER_MODEL) when nothing is set', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => undefined,
      getModel: () => undefined,
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-1',
    });
    expect(state.provider).toBe(UNCONFIGURED_PROVIDER);
    expect(state.model).toBe(PLACEHOLDER_MODEL);
    // Must NOT fall back to Gemini defaults.
    expect(state.provider).not.toBe('gemini');
    expect(state.model).not.toBe('gemini-2.5-pro');
  });

  it('returns UNCONFIGURED_PROVIDER when provider getter returns empty string', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => '',
      getModel: () => '',
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-3',
    });
    expect(state.provider).toBe(UNCONFIGURED_PROVIDER);
    expect(state.model).toBe(PLACEHOLDER_MODEL);
  });

  it('preserves an explicit provider', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => 'openai',
      getModel: () => 'gpt-4',
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-4',
    });
    expect(state.provider).toBe('openai');
    expect(state.model).toBe('gpt-4');
  });

  it('preserves an explicit gemini provider with its default model', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => 'gemini',
      getModel: () => 'gemini-2.5-pro',
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-5',
    });
    expect(state.provider).toBe('gemini');
    expect(state.model).toBe('gemini-2.5-pro');
  });

  it('uses contentGeneratorConfig model when config.getModel is empty', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => 'anthropic',
      getModel: () => '',
      getContentGeneratorConfig: () => ({ model: 'claude-3.5-sonnet' }),
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-6',
    });
    expect(state.provider).toBe('anthropic');
    expect(state.model).toBe('claude-3.5-sonnet');
  });

  it('respects override provider and model', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => undefined,
      getModel: () => undefined,
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-7',
      overrides: { provider: 'ollama', model: 'llama3' },
    });
    expect(state.provider).toBe('ollama');
    expect(state.model).toBe('llama3');
  });
});

describe('createAgentRuntimeStateFromConfig: adversarial provider inputs', () => {
  it('returns UNCONFIGURED_PROVIDER when getProvider returns null at runtime', () => {
    const config = {
      getProvider: () => null,
      getModel: () => undefined,
    } as unknown as RuntimeStateConfigSource;
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-null',
    });
    expect(state.provider).toBe(UNCONFIGURED_PROVIDER);
  });

  it('returns UNCONFIGURED_PROVIDER when getProvider returns whitespace-only string', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => '   ',
      getModel: () => undefined,
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-ws',
    });
    expect(state.provider).toBe(UNCONFIGURED_PROVIDER);
  });

  it('trims a provider string with surrounding whitespace', () => {
    const config: RuntimeStateConfigSource = {
      getProvider: () => '  openai  ',
      getModel: () => undefined,
    };
    const state = createAgentRuntimeStateFromConfig(config, {
      runtimeId: 'test-rt-trim',
    });
    expect(state.provider).toBe('openai');
  });
});
