/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export function makeRuntimeContext(
  includeThoughts: boolean,
): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'p14-test',
    provider: 'test',
    model: 'test-model',
    sessionId: 'test-session',
  });
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
    provider: {} as never,
    telemetry: {} as never,
    tools: {} as never,
    providerRuntime: {} as never,
  });
}
