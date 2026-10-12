/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import * as publicApi from '@vybestack/llxprt-code-agents';
import { describe, it, expect } from 'bun:test';
import {
  assembleAgentActivationBootstrap,
  fromConfig,
  type ProviderActivationIntent,
  type AgentActivationPreflightResult,
} from '@vybestack/llxprt-code-agents';
import { drain, countType } from './helpers/agentHarness.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

function configActiveProvider(manager: {
  getActiveProviderName(): string | undefined;
}): string | undefined {
  return manager.getActiveProviderName();
}

describe('AgentActivationBootstrap @plan:PLAN-20270110-ISSUE2378.P05 @requirement:REQ-2378-005', () => {
  it('activates the configured provider and reports a non-fatal auth outcome', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const manager = built.providerManager;

      const operation = assembleAgentActivationBootstrap(
        built.config,
        built.settingsService,
        manager,
        null,
        () => undefined,
        built.agentClient,
        built.mcpRuntime,
      );
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        defaultProvider: 'gemini',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };

      const result: AgentActivationPreflightResult =
        await operation.preflight(intent);
      await operation.dispose();

      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      // Observable auth materialization: the CLI override path applied the key
      // to the active provider and set the auth-key ephemeral.
      expect(built.settingsOwner.readNamedParameter('auth-key')).toBe(
        'sk-test-key',
      );
      expect(configActiveProvider(built.providerManager)).toBe('fake');
    } finally {
      await built.cleanup();
    }
  });

  it('reports a fatal auth outcome (authFailed true + authError) for an explicit failing provider', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const manager = built.providerManager;

      const operation = assembleAgentActivationBootstrap(
        built.config,
        built.settingsService,
        manager,
        null,
        () => undefined,
        built.agentClient,
        built.mcpRuntime,
      );
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };

      const result: AgentActivationPreflightResult =
        await operation.preflight(intent);
      await operation.dispose();

      // The CLI maps authFailed true → FATAL_AUTHENTICATION_ERROR; the typed
      // authError must be populated so the fatal decision carries the cause.
      expect(result.authFailed).toBe(true);
      expect(result.authError).toBeDefined();
    } finally {
      await built.cleanup();
    }
  });

  it('does not throw on auth failure — the outcome is returned as data, not raised', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const manager = built.providerManager;

      const operation = assembleAgentActivationBootstrap(
        built.config,
        built.settingsService,
        manager,
        null,
        () => undefined,
        built.agentClient,
        built.mcpRuntime,
      );
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };

      // preflight returns the outcome as a typed value (never throws for an
      // auth failure); the CLI observes result.authFailed to decide fatality.
      await expect(operation.preflight(intent)).resolves.toMatchObject({
        authFailed: true,
      });
      await operation.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('adopting the same Config after preflight does not re-run a second activation sequence (single sequence)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const manager = built.providerManager;

      const operation = assembleAgentActivationBootstrap(
        built.config,
        built.settingsService,
        manager,
        null,
        () => undefined,
        built.agentClient,
        built.mcpRuntime,
      );
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };

      const first = await operation.preflight(intent);
      expect(first.authFailed).toBe(false);
      expect(configActiveProvider(built.providerManager)).toBe('fake');

      if (!first.token) throw new Error('Missing token');
      const client = built.agentClient;
      const agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: { operation, token: first.token },
      });
      expect(agent.agentClient).toBe(client);
      expect(configActiveProvider(built.providerManager)).toBe('fake');
      await agent.dispose();
      expect(built.settingsOwner.readNamedParameter('auth-key')).toBe(
        'sk-test-key',
      );
    } finally {
      await built.cleanup();
    }
  });

  it('exposes bootstrap assembly without free receipt or activation-preflight APIs', () => {
    expect(publicApi.assembleAgentActivationBootstrap).toBeFunction();
    for (const name of [
      'preflightAgentActivation',
      'AgentActivationBootstrap',
      'clearCompletedActivationPreflight',
      'recordCompletedActivationPreflight',
      'consumeCompletedActivationPreflight',
      'inspectCompletedActivationPreflight',
    ]) {
      expect(publicApi).not.toHaveProperty(name);
    }
  });
});

describe('preflight agent-owned runtime factory assembly @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
  it('installs absent client and task defaults before activation and executes an adopted tool turn', async () => {
    const built = await buildCliStyleConfig('tool-call-then-answer.jsonl');
    expect(built.mcpRuntime.toolSelection.getTool('task')).toBeUndefined();
    const manager = built.providerManager;

    const operation = assembleAgentActivationBootstrap(
      built.config,
      built.settingsService,
      manager,
      null,
      () => undefined,
      built.agentClient,
      built.mcpRuntime,
    );
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      authMode: 'auto',
    };
    let agent: Awaited<ReturnType<typeof fromConfig>> | undefined;
    try {
      const result = await operation.preflight(intent);
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      if (!result.token) throw new Error('Missing preflight token');
      agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        messageBus: built.messageBus,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: { operation, token: result.token },
      });
      const events = await drain(agent.stream('read package metadata'));
      expect(countType(events, 'tool-result')).toBeGreaterThan(0);
      expect(countType(events, 'done')).toBe(1);
      expect(agent.tools.get('task')?.name).toBe('task');
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  });

  it('preserves caller client factory and adopted scheduler handle lifetime after preflight', async () => {
    const clientFactory =
      createAgentRuntimeFactoryBindings().agentClientFactory;
    const callerClients = new Set<ReturnType<typeof clientFactory>>();
    const runtimeFactoryBindings = {
      ...createAgentRuntimeFactoryBindings(),
      agentClientFactory: (...args: Parameters<typeof clientFactory>) => {
        const client = clientFactory(...args);
        callerClients.add(client);
        return client;
      },
    };
    const built = await buildCliStyleConfig(
      'tool-call-then-answer.jsonl',
      {},
      runtimeFactoryBindings,
    );
    const manager = built.providerManager;

    const operation = assembleAgentActivationBootstrap(
      built.config,
      built.settingsService,
      manager,
      null,
      () => undefined,
      built.agentClient,
      built.mcpRuntime,
    );
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      cliOverrides: { key: 'caller-preflight-key' },
      authMode: 'auto',
    };
    let created = 0;
    let active = 0;
    let agent: Awaited<ReturnType<typeof fromConfig>> | undefined;
    try {
      const result = await operation.preflight(intent);
      expect(result.authFailed).toBe(false);
      if (!result.token) throw new Error('Missing preflight token');
      agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        messageBus: built.messageBus,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: { operation, token: result.token },
        toolSchedulerFactory: () => {
          created += 1;
          active += 1;
          return {
            dispose: () => {
              active -= 1;
            },
          };
        },
      });
      const events = await drain(agent.stream('read package metadata'));
      expect(countType(events, 'tool-result')).toBeGreaterThan(0);
      expect(created).toBeGreaterThan(0);
      expect(active).toBe(created);
      expect(callerClients.has(built.agentClient)).toBe(true);
      await agent.dispose();
      expect(active).toBe(0);
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  });
});
