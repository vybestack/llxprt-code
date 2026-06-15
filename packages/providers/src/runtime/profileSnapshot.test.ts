/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import type { Profile } from '@vybestack/llxprt-code-settings';

// Mock external dependencies of applyProfileSnapshot so we can verify
// emission without bootstrapping the entire CLI runtime.
vi.mock('./runtimeAccessors.js', () => ({
  getCliRuntimeServices: vi.fn(() => ({
    config: {},
    settingsService: { setCurrentProfileName: vi.fn() },
    providerManager: {},
  })),
  getCliOAuthManager: vi.fn(() => null),
  getActiveModelName: vi.fn(() => 'test-model'),
  getActiveModelParams: vi.fn(() => ({})),
  _internal: {
    resolveActiveProviderName: vi.fn(() => 'test-provider'),
    getProviderSettingsSnapshot: vi.fn(() => ({})),
    getActiveProviderOrThrow: vi.fn(),
    extractModelParams: vi.fn(() => ({})),
  },
}));

vi.mock('./profileApplication.js', () => ({
  applyProfileWithGuards: vi.fn(
    async (profile: { provider: string; model: string }) => ({
      providerName: profile.provider,
      modelName: profile.model,
      infoMessages: [],
      warnings: [],
      providerChanged: true,
      baseUrl: undefined,
      didFallback: false,
      requestedProvider: profile.provider,
    }),
  ),
}));

import {
  applyProfileSnapshot,
  buildModelProfileInfoPayload,
} from './profileSnapshot.js';

describe('buildModelProfileInfoPayload', () => {
  it('builds payload with profile name as displayLabel when profile is active', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'gpt-4o',
      providerName: 'openai',
      profileName: 'production',
    });

    expect(payload).toStrictEqual({
      model: 'gpt-4o',
      providerName: 'openai',
      profileName: 'production',
      displayLabel: 'production',
    });
  });

  it('uses model name as displayLabel when no profile is active', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'llama3',
      providerName: 'ollama',
      profileName: null,
    });

    expect(payload).toStrictEqual({
      model: 'llama3',
      providerName: 'ollama',
      profileName: null,
      displayLabel: 'llama3',
    });
  });

  it('uses model name as displayLabel when profile name is empty string', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'gemini-2.0-flash',
      providerName: 'gemini',
      profileName: '',
    });

    expect(payload.displayLabel).toBe('gemini-2.0-flash');
  });

  it('falls back to model name when providerName is absent', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'test-model',
      profileName: 'my-profile',
    });

    expect(payload).toStrictEqual({
      model: 'test-model',
      providerName: undefined,
      profileName: 'my-profile',
      displayLabel: 'my-profile',
    });
  });

  it('prefers displayName over profileName and model when supplied', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'gpt-4o',
      providerName: 'openai',
      profileName: 'production',
      displayName: 'Production Environment',
    });

    expect(payload).toStrictEqual({
      model: 'gpt-4o',
      providerName: 'openai',
      profileName: 'production',
      displayName: 'Production Environment',
      displayLabel: 'Production Environment',
    });
  });

  it('prefers displayName even when no profile is active', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'llama3',
      providerName: 'ollama',
      profileName: null,
      displayName: 'My Ollama Setup',
    });

    expect(payload.displayLabel).toBe('My Ollama Setup');
    expect(payload.displayName).toBe('My Ollama Setup');
  });

  it('ignores empty displayName and falls back to profileName', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'gpt-4o',
      providerName: 'openai',
      profileName: 'work',
      displayName: '',
    });

    expect(payload.displayLabel).toBe('work');
  });

  it('ignores whitespace-only displayName and falls back to profileName', () => {
    const payload = buildModelProfileInfoPayload({
      model: 'gpt-4o',
      providerName: 'openai',
      profileName: 'work',
      displayName: '   ',
    });

    expect(payload.displayLabel).toBe('work');
  });

  /**
   * Rationale (issue #1770 fix #5): The Profile schema (StandardProfile |
   * LoadBalancerProfile) does NOT define a displayName or name field.
   * The profile key name (options.profileName) IS the display label.
   * No schema expansion is necessary — buildModelProfileInfoPayload already
   * accepts an optional displayName for forward compatibility if a future
   * schema change adds one.
   */
  it('uses profileName as displayLabel because Profile schema has no displayName field', () => {
    // Simulate what applyProfileSnapshot does: pass profileName as the display
    // label source, with no explicit displayName.
    const payload = buildModelProfileInfoPayload({
      model: 'claude-sonnet',
      providerName: 'anthropic',
      profileName: 'my-custom-profile',
      // No displayName — simulating the current Profile schema
    });

    expect(payload.displayLabel).toBe('my-custom-profile');
    expect(payload.displayName).toBeUndefined();
  });

  it('would use displayName if Profile schema adds one in the future', () => {
    // Forward-compatibility test: if a displayName field is added to the
    // Profile schema, applyProfileSnapshot can pass it and it takes precedence.
    const payload = buildModelProfileInfoPayload({
      model: 'claude-sonnet',
      providerName: 'anthropic',
      profileName: 'raw-key',
      displayName: 'My Friendly Profile Name',
    });

    expect(payload.displayLabel).toBe('My Friendly Profile Name');
    expect(payload.displayName).toBe('My Friendly Profile Name');
  });
});

describe('ModelProfileChanged emission from applyProfileSnapshot', () => {
  beforeEach(() => {
    coreEvents.removeAllListeners();
    vi.clearAllMocks();
  });

  afterEach(() => {
    coreEvents.removeAllListeners();
    vi.restoreAllMocks();
  });

  it('emits ModelProfileChanged event with model, provider, and profile from application result', async () => {
    const listener = vi.fn();
    coreEvents.on(CoreEvent.ModelProfileChanged, listener);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileSnapshot(profile, { profileName: 'work' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet',
        providerName: 'anthropic',
        profileName: 'work',
        displayLabel: 'work',
      }),
    );
  });

  it('uses model as displayLabel when profileName is null', async () => {
    const listener = vi.fn();
    coreEvents.on(CoreEvent.ModelProfileChanged, listener);

    const profile: Profile = {
      version: 1,
      provider: 'ollama',
      model: 'llama3',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileSnapshot(profile, { profileName: undefined });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'llama3',
        profileName: null,
        displayLabel: 'llama3',
      }),
    );
  });

  it('does not emit before applyProfileSnapshot is called', async () => {
    const listener = vi.fn();
    coreEvents.on(CoreEvent.ModelProfileChanged, listener);

    // Just attaching the listener should not produce any emission
    expect(listener).not.toHaveBeenCalled();

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileSnapshot(profile, { profileName: 'prod' });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
