/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

const owners: SessionSettingsOwner[] = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.dispose();
});

export function makeRuntimeContext(
  includeThoughts: boolean,
): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'p14-test',
    provider: 'test',
    model: 'test-model',
    sessionId: 'test-session',
  });
  const settingsService = new SettingsService();
  settingsService.set('reasoning.includeInContext', includeThoughts);
  const owner = new SessionSettingsOwner(settingsService);
  owners.push(owner);
  return createAgentRuntimeContext({
    state,
    history: new HistoryService(),
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      'reasoning.includeInContext': includeThoughts,
    },
    provider: createProviderAdapterFromManager(undefined),
    telemetry: {
      logApiRequest: () => {},
      logApiResponse: () => {},
      logApiError: () => {},
    },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    providerRuntime: createProviderRuntimeContext({
      runtimeId: state.runtimeId,
    }),
    prepareProviderInvocation: (name, parameters, signal) =>
      owner.prepareProviderInvocation(
        state.runtimeId,
        name,
        parameters,
        signal,
        undefined,
        globalThis.fetch,
      ),
  });
}
