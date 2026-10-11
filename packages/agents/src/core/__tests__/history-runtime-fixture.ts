/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

const roots: SessionSettingsOwner[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await root.dispose();
});

export function createHistoryRuntimeFixture(options: {
  readonly state: AgentRuntimeState;
  readonly history: HistoryService;
  readonly policy: ReadonlySettingsSnapshot;
}): AgentRuntimeContext {
  const settingsService = new SettingsService();
  settingsService.set(
    'compression-threshold',
    options.policy.compressionThreshold,
  );
  settingsService.set('context-limit', options.policy.contextLimit);
  settingsService.set(
    'compression-preserve-threshold',
    options.policy.preserveThreshold,
  );
  settingsService.set(
    'reasoning.includeInContext',
    options.policy['reasoning.includeInContext'],
  );
  const owner = new SessionSettingsOwner(settingsService);
  roots.push(owner);
  return createAgentRuntimeContext({
    state: options.state,
    history: options.history,
    settings: {
      ...options.policy,
      ...owner.readRuntimePolicy(),
      telemetry: options.policy.telemetry,
    },
    provider: createProviderAdapterFromManager(undefined),
    telemetry: {
      logApiRequest: () => {},
      logApiResponse: () => {},
      logApiError: () => {},
    },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    providerRuntime: createProviderRuntimeContext({
      settingsService,
      runtimeId: options.state.runtimeId,
    }),
    prepareProviderInvocation: (name, parameters, signal) =>
      owner.prepareProviderInvocation(
        options.state.runtimeId,
        name,
        parameters,
        signal,
      ),
  });
}
