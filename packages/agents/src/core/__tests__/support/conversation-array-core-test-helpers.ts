/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { TestRuntimeProviderManager } from '../../../test-utils/runtimeProviderManager.js';
import { createConfigParams } from '../../chatSession-runtime-helpers.js';
import { ConversationManager } from '../../ConversationManager.js';

/**
 * Conversation-array helpers that need no test-runner hooks. The memory probe
 * child processes run outside `bun test`, so they import this module and
 * supply their own telemetry and tool owners; tests use `conversation-array-test-helpers`
 * whose fixture owner is disposed by the runner.
 */
export interface ConversationOwners {
  readonly telemetryFor: (config: Config) => RootTelemetry;
  readonly selectTools: () => ToolSelection;
}

export function conversationWithOwners(
  history: HistoryService,
  owners: ConversationOwners,
): ConversationManager {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));
  const providerRuntime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'conversation-array',
  });
  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  configureProviderRuntimeFactories(config, manager);
  const runtime = createAgentRuntimeContext({
    prepareProviderInvocation: (name, parameters, signal) =>
      captureProviderInvocation(providerRuntime, name, parameters, signal),
    state: createAgentRuntimeState({
      runtimeId: 'conversation-array',
      provider: 'test',
      model: 'restore-model',
      sessionId: 'conversation-array',
    }),
    history,
    settings: { contextLimit: 100_000_000 },
    provider: createProviderAdapterFromManager(manager),
    telemetry: createTelemetryAdapter(config, owners.telemetryFor(config)),
    tools: createToolRegistryViewFromRegistry(owners.selectTools()),
    providerRuntime: { ...providerRuntime },
  });
  return new ConversationManager(history, runtime);
}

export function forbidArrayRollback(history: HistoryService): void {
  const reject = async (): Promise<never> => {
    throw new Error('Conversation restore entered legacy array rollback');
  };
  history.replaceAll = reject;
  history.replaceBatch = reject;
}

export function recordArrayProof(value: object): void {
  const output = process.env.CONVERSATION_ARRAY_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(value) + '\n');
}

export function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
