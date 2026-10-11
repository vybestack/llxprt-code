import { afterEach } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
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
      settingsService,
      runtimeId: state.runtimeId,
    }),
    prepareProviderInvocation: (name, parameters, signal) =>
      owner.prepareProviderInvocation(
        state.runtimeId,
        name,
        parameters,
        signal,
      ),
  });
}

// ---------------------------------------------------------------------------
// Helper: extract observable text from committed history
// ---------------------------------------------------------------------------

export function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

export function getRecordedHistoryText(history: HistoryService): string {
  const all = history.getAll();
  return all
    .filter((c) => c.speaker === 'ai')
    .flatMap((c) => c.blocks)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
}

export function getRecordedThinkingBlocks(
  history: HistoryService,
): Array<{ thought: string; signature?: string }> {
  return history
    .getAll()
    .filter((c) => c.speaker === 'ai')
    .flatMap((c) => c.blocks)
    .filter((b) => b.type === 'thinking')
    .map((b) => {
      const tb = b as { thought: string; signature?: string };
      return { thought: tb.thought, signature: tb.signature };
    });
}
