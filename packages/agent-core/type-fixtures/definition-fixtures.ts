/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentDefinition } from '../src/types.js';

export const validDefinition: AgentDefinition = {
  name: 'assistant',
  instructions: [],
  model: {
    primary: { ref: { provider: 'local', model: 'test' }, parameters: {} },
    fallbacks: [],
    fallbackOn: [],
  },
  tools: [],
  policy: {
    authority: [],
    preferences: [],
    sourceStacks: [],
    approvalMode: 'default',
    fallback: 'deny',
  },
  limits: { maxStepsPerTurn: 12, maxParallelChildren: 2 },
  context: {
    compactAtRatio: 0.8,
    keepRecentTurns: 4,
    summarizer: 'active-model',
  },
  retry: { maxAttempts: 3, backoffMs: [10, 30] },
  loop: { maxIdenticalCalls: 2, maxStepsWithoutProgress: 5 },
  subagents: [],
  toolOutput: {
    maxResultBytes: 4096,
    maxStepResultBytes: 8192,
    truncation: 'head-and-tail',
  },
};
