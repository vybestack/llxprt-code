/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'bun:test';
import {
  fromConfig,
  type Agent,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import { getActiveProviderName } from '@vybestack/llxprt-code-providers/runtime.js';
import {
  buildCliStyleConfig,
  type MessageBus,
} from './helpers/buildCliStyleConfig.js';

describe('fromConfig executes the activation intent (#2374)', () => {
  it('(a) fromConfig with activation intent activates the provider', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        defaultProvider: 'gemini',
        model: 'fake-model',
        authMode: 'auto',
      };
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
      });
      expect(agent.getProvider()).toBe('fake');
      expect(
        getActiveProviderName(built.settingsOwner, built.providerManager),
      ).toBe('fake');
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('(d) profile-auth-ephemerals survive fromConfig (provider already active + ephemerals intact)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // Simulate a profile-loaded provider runtime: the provider is already
      // active and profile auth ephemerals are present.
      built.settingsOwner.writeUserParameter(
        'auth-keyfile',
        '/tmp/profile.key',
      );
      built.settingsOwner.writeUserParameter(
        'base-url',
        'https://profile.example/v1',
      );

      const beforeKeyfile =
        built.settingsOwner.readNamedParameter('auth-keyfile');
      const beforeBaseUrl = built.settingsOwner.readNamedParameter('base-url');
      expect(beforeKeyfile).toBe('/tmp/profile.key');
      expect(beforeBaseUrl).toBe('https://profile.example/v1');

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      };
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
      });
      try {
        // The profile auth ephemerals MUST survive fromConfig — the provider
        // was already active WITH profile ephemerals, so fromConfig must NOT
        // re-switch / clear them (the restoreActiveProvider compensation is
        // unnecessary).
        expect(built.settingsOwner.readNamedParameter('auth-keyfile')).toBe(
          '/tmp/profile.key',
        );
        expect(built.settingsOwner.readNamedParameter('base-url')).toBe(
          'https://profile.example/v1',
        );
        expect(built.providerManager.getActiveProviderName()).toBe('fake');
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('(f) fromConfig with authMode none skips auth refresh', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'none',
      };
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
      });
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('fromConfig without activation preserves backward-compatible behavior', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerBus: MessageBus = built.messageBus;
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: callerBus,
      });
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });
});
