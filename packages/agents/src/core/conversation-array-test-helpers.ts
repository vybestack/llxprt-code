/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { installModelToolFixture } from './__tests__/model-tool-fixture.js';
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
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';
import { ConversationManager } from './ConversationManager.js';
import type { RowOwnershipStats } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { appendFileSync } from 'node:fs';

const modelTools = installModelToolFixture();

export function conversationFor(history: HistoryService): ConversationManager {
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
    telemetry: createTelemetryAdapter(
      config,
      createSessionSettingsFixture(config).settingsOwner.telemetry,
    ),
    tools: createToolRegistryViewFromRegistry(modelTools()),
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

export function boundedOwners(stats: RowOwnershipStats): boolean {
  return stats.liveRows <= 440 && stats.liveSerializedBytes <= 8 * 1024 * 1024;
}

export function expectBatchObserverOwners(
  stats: RowOwnershipStats,
  size: number,
  retain: boolean,
): void {
  if (retain) {
    expect(stats.liveRows).toBeGreaterThanOrEqual(size);
    expect(stats.liveSerializedBytes).toBeGreaterThan(
      size === 8192 ? 8 * 1024 * 1024 : size * 2048,
    );
  } else {
    expect(stats.liveRows).toBeLessThanOrEqual(3);
    expect(boundedOwners(stats)).toBe(true);
  }
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
