/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import {
  createAllowPolicyEngine,
  createTestConfig,
} from '../../core/agenticLoop/__tests__/agenticLoop-test-helpers.js';
import { TurnToolExecutionOwner } from '../../session/turn-tool-execution-owner.js';
import { HookControl } from '../control/hooks.js';
import { ToolConfirmationOutcome } from './helpers/agentHarness.js';

/**
 * Conservation target for the former `disposal.spec.ts` scenario "T13
 * messageBus has zero subscriptions after dispose", which counted every
 * listener on the Agent's bus after `agent.dispose()`. No public Agent member
 * returns that bus, so the whole-bus contract is split by subscriber: each
 * production subscriber on the agent's session bus is built through its
 * production constructor over a bus the test owns, and its own disposal must
 * return the listener count over every `MessageBusType` to the count before
 * it existed. The policy owner's subscriber is covered by
 * `runtime-policy-owner-disposal.behavior.test.ts`. The Agent-level disposal
 * effects stay in `disposal.spec.ts` (scheduler handles disposed, session
 * lock released, client torn down).
 */
function subscriptionCount(bus: MessageBus): number {
  return Object.values(MessageBusType).reduce<number>(
    (count, type) => count + bus.listenerCount(type),
    0,
  );
}

describe('Agent message bus subscribers release their listeners on disposal', () => {
  it('ConfirmationCoordinator (owned by CoreToolScheduler) returns the bus to its baseline on scheduler.dispose()', () => {
    const policy = createAllowPolicyEngine();
    const bus = new MessageBus(policy, false);
    const registry = new ToolRegistry(
      {},
      bus,
      assembleTaskSchemaPolicy({
        get: () => undefined,
        getAllGlobalSettings: () => ({}),
      }),
    );
    const { config, settingsOwner } = createTestConfig({
      messageBus: bus,
      policyEngine: policy,
      toolRegistry: registry,
      interactive: false,
    });
    const baseline = subscriptionCount(bus);

    const scheduler = new CoreToolScheduler({
      telemetry: RootTelemetry.prepare({
        enabled: false,
        sessionId: 'coordinator-disposal',
        maxBytes: 1024,
        maxFiles: 1,
      }),
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () => settingsOwner.readToolGovernance([]),
      config,
      messageBus: bus,
      toolRegistry: registry,
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE)).toBe(
      1,
    );
    expect(subscriptionCount(bus)).toBe(baseline + 1);

    scheduler.dispose();

    expect(subscriptionCount(bus)).toBe(baseline);
  });

  it('TurnToolExecutionOwner returns the bus to its baseline when the turn run is released and when the owner is retired', () => {
    const bus = new MessageBus(createAllowPolicyEngine(), false);
    const baseline = subscriptionCount(bus);
    const owner = new TurnToolExecutionOwner(
      bus,
      async () => ({ outcome: ToolConfirmationOutcome.Cancel }),
      () => {
        throw new Error('This test never acquires a scheduler');
      },
    );

    const release = owner.begin();
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(1);
    release();
    expect(subscriptionCount(bus)).toBe(baseline);

    owner.begin();
    expect(subscriptionCount(bus)).toBe(baseline + 1);
    owner.retire();
    expect(subscriptionCount(bus)).toBe(baseline);
  });

  it('HookControl returns the bus to its baseline on detach()', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hook-control-disposal-'));
    const bus = new MessageBus();
    const config = new Config({
      sessionId: 'hook-control-disposal',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      enableHooks: true,
      trustedFolder: true,
    });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const owner = new SessionHookOwner(
      readHookDefinitions(config),
      hookSessionRuntime(
        config,
        trust,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'hook-control-disposal',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      false,
      bus,
    );
    try {
      const baseline = subscriptionCount(bus);
      const control = new HookControl({
        hookOperations: owner,
        observeRequests: (listener) =>
          bus.subscribe(MessageBusType.HOOK_EXECUTION_REQUEST, listener),
        observeResponses: (listener) =>
          bus.subscribe(MessageBusType.HOOK_EXECUTION_RESPONSE, listener),
        sessionId: () => config.getSessionId(),
        cwd: () => directory,
      });
      expect(bus.listenerCount(MessageBusType.HOOK_EXECUTION_REQUEST)).toBe(1);
      expect(bus.listenerCount(MessageBusType.HOOK_EXECUTION_RESPONSE)).toBe(1);

      control.detach();

      expect(subscriptionCount(bus)).toBe(baseline);
    } finally {
      await owner.dispose();
      await trust.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('SessionHookOwner (HookEventHandler of its HookSystem) returns the bus to its baseline on dispose()', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hook-owner-disposal-'));
    const bus = new MessageBus();
    const baseline = subscriptionCount(bus);
    const config = new Config({
      sessionId: 'hook-owner-disposal',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      enableHooks: true,
      trustedFolder: true,
    });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const owner = new SessionHookOwner(
      readHookDefinitions(config),
      hookSessionRuntime(
        config,
        trust,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'hook-owner-disposal',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      true,
      bus,
    );
    try {
      await owner.reloadDefinitions();
      expect(bus.listenerCount(MessageBusType.HOOK_EXECUTION_REQUEST)).toBe(1);
      expect(subscriptionCount(bus)).toBe(baseline + 1);

      await owner.dispose();

      expect(subscriptionCount(bus)).toBe(baseline);
    } finally {
      await owner.dispose();
      await trust.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
