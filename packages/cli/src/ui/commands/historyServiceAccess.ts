/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ChronologyTraceEntry,
  IContent,
} from '@vybestack/llxprt-code-core';
import type { CommandContext } from './types.js';

export interface HistoryServiceView {
  getAll: () => unknown;
  getChronologyTrace: () => readonly ChronologyTraceEntry[];
  getRawHistory: () => readonly IContent[];
}

export function getHistoryServiceFromAgent(
  agent: CommandContext['services']['agent'],
): HistoryServiceView | null {
  return agent?.agentClient.getHistoryService() ?? null;
}

export function requireSessionAgent(
  context: CommandContext,
): NonNullable<CommandContext['services']['agent']> {
  const agent = context.services.agent;
  if (!agent) throw new Error('Session agent is unavailable');
  return agent;
}
