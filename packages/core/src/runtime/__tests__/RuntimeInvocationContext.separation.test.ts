/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P07
 *
 * Tests for settings separation in RuntimeInvocationContext.
 * Verifies that the factory correctly calls separateSettings() and populates
 * cliSettings/modelBehavior/modelParams/customHeaders.
 *
 * Implementation already exists in Phase 06 - these tests verify GREEN state.
 */

import { describe, it, expect } from 'vitest';
import { createRuntimeInvocationContext } from '../RuntimeInvocationContext.js';
import type { ProviderRuntimeContext } from '../providerRuntimeContext.js';
import type { SettingsService } from '../../settings/SettingsService.js';

describe('RuntimeInvocationContext Settings Separation', () => {
  function createMockSettings(): SettingsService {
    return {
      getAllGlobalSettings: () => ({}),
      getProviderSettings: () => ({}),
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
    } as unknown as SettingsService;
  }

  function createMockRuntime(
    runtimeId: string = 'test-runtime-id',
  ): ProviderRuntimeContext {
    return {
      runtimeId,
      metadata: {},
    } as ProviderRuntimeContext;
  }

  /**
   * GROUP 1: Field population
   * Each test verifies one field is populated correctly.
   */

  it('context created with temperature=0.7 in ephemerals returns 0.7 from getModelParam', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: { temperature: 0.7 },
    });

    expect(context.getModelParam('temperature')).toBe(0.7);
  });

  it('context created with shell-replacement=none returns none from getCliSetting', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: { 'shell-replacement': 'none' },
    });

    expect(context.getCliSetting('shell-replacement')).toBe('none');
  });

  it('context created with reasoning.enabled=true returns true from getModelBehavior', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: { 'reasoning.enabled': true },
    });

    expect(context.getModelBehavior('reasoning.enabled')).toBe(true);
  });

  it('context created with custom-headers has X-Foo=bar in customHeaders', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        'custom-headers': { 'X-Foo': 'bar' },
      },
    });

    expect(context.customHeaders['X-Foo']).toBe('bar');
  });

  /**
   * GROUP 2: Separation correctness
   * Each test verifies one category is NOT contaminated by another.
   */

  it('context with shell-replacement in ephemerals does not contain shell-replacement in modelParams', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        'shell-replacement': 'none',
        temperature: 0.7,
      },
    });

    expect(context.modelParams['shell-replacement']).toBeUndefined();
  });

  it('context with temperature in ephemerals does not contain temperature in cliSettings', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.7,
        'shell-replacement': 'none',
      },
    });

    expect(context.cliSettings['temperature']).toBeUndefined();
  });

  it('context with apiKey in ephemerals does not contain apiKey in modelParams', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        apiKey: 'sk-test-key',
        temperature: 0.7,
      },
    });

    expect(context.modelParams['apiKey']).toBeUndefined();
  });

  /**
   * GROUP 3: Alias resolution
   * Tests verify aliases are resolved to canonical keys.
   */

  it('context with max-tokens=4096 in ephemerals returns 4096 from getModelParam using max_tokens', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        'max-tokens': 4096,
      },
    });

    expect(context.getModelParam('max_tokens')).toBe(4096);
  });

  /**
   * GROUP 4: Backward compatibility
   * Tests verify ephemerals field still works for legacy access.
   */

  it('context with temperature=0.7 in ephemerals still contains temperature in ephemerals field', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.7,
      },
    });

    expect(context.ephemerals['temperature']).toBe(0.7);
  });

  it('context with shell-replacement=none in ephemerals still contains shell-replacement in ephemerals field', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        'shell-replacement': 'none',
      },
    });

    expect(context.ephemerals['shell-replacement']).toBe('none');
  });

  /**
   * GROUP 5: Frozen snapshots
   * Tests verify all separated fields are frozen.
   */

  it('cliSettings is frozen', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        'shell-replacement': 'none',
      },
    });

    expect(Object.isFrozen(context.cliSettings)).toBe(true);
  });

  it('modelParams is frozen', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.7,
      },
    });

    expect(Object.isFrozen(context.modelParams)).toBe(true);
  });

  it('modelBehavior is frozen', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        'reasoning.enabled': true,
      },
    });

    expect(Object.isFrozen(context.modelBehavior)).toBe(true);
  });

  it('customHeaders is frozen', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        'custom-headers': { 'X-Foo': 'bar' },
      },
    });

    expect(Object.isFrozen(context.customHeaders)).toBe(true);
  });

  /**
   * Additional edge case tests
   */

  it('context with empty ephemerals has empty cliSettings', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {},
    });

    expect(Object.keys(context.cliSettings).length).toBe(0);
  });

  it('context with empty ephemerals has empty modelParams', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {},
    });

    expect(Object.keys(context.modelParams).length).toBe(0);
  });

  it('context with multiple settings puts temperature in modelParams', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.7,
        'max-tokens': 4096,
        'shell-replacement': 'none',
        'reasoning.enabled': true,
      },
    });

    expect(context.modelParams['temperature']).toBe(0.7);
  });

  it('context with multiple settings puts max-tokens in modelParams', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.7,
        'max-tokens': 4096,
        'shell-replacement': 'none',
        'reasoning.enabled': true,
      },
    });

    expect(context.modelParams['max_tokens']).toBe(4096);
  });

  it('context with multiple settings puts shell-replacement in cliSettings', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.7,
        'max-tokens': 4096,
        'shell-replacement': 'none',
        'reasoning.enabled': true,
      },
    });

    expect(context.cliSettings['shell-replacement']).toBe('none');
  });

  it('context with multiple settings puts reasoning.enabled in modelBehavior', () => {
    const context = createRuntimeInvocationContext({
      runtime: createMockRuntime(),
      settings: createMockSettings(),
      providerName: 'openai',
      ephemeralsSnapshot: {
        temperature: 0.7,
        'max-tokens': 4096,
        'shell-replacement': 'none',
        'reasoning.enabled': true,
      },
    });

    expect(context.modelBehavior['reasoning.enabled']).toBe(true);
  });
});
