/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for subagent orchestrator test files. Extracted from the
 * original monolithic subagentOrchestrator.test.ts so no file-level
 * max-lines disable is needed.
 */

import { vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { type SubAgentScope as SubAgentScopeInstance } from '../subagent.js';

export function makeForegroundConfig(): Config {
  return {
    getSessionId: () => 'primary-session',
    getProvider: () => 'gemini',
    getContentGeneratorConfig: () => undefined,
    getModel: () => 'gemini-1.5-flash',
    getToolRegistry: () => undefined,
  } as unknown as Config;
}

export function createRuntimeBundle(label = 'bundle') {
  const clearHistory = vi.fn();
  const history = { clear: clearHistory } as unknown as {
    clear: () => void;
  };
  const runtimeContext = {
    state: { runtimeId: `${label}-runtime-id`, sessionId: `${label}-session` },
    history,
    ephemerals: {
      compressionThreshold: () => 0.85,
      contextLimit: () => 20_000,
      preserveThreshold: () => 0.3,
      toolFormatOverride: () => undefined,
    },
    telemetry: {},
    provider: {},
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    providerRuntime: {},
  } as unknown as SubAgentScopeInstance['runtimeContext'];

  return {
    runtimeContext,
    history,
    providerAdapter: {},
    telemetryAdapter: {},
    toolsView: {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    },
    contentGenerator: {},
  };
}
