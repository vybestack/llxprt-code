import type { AgentSchedulerFactory } from '../../config-types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { stripSandboxSegment } from './fixtureRoot.js';
import type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const HARNESS_DIR = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
export const fixturesDir = resolve(HARNESS_DIR, '..', 'fixtures');
export interface ComparableEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly doneReason?: DoneReason;
}
export function projectToComparable(event: AgentEvent): ComparableEvent {
  switch (event.type) {
    case 'tool-call':
      return { type: event.type, toolName: event.call.name };
    case 'tool-result':
      return {
        type: event.type,
        toolName: event.result.name,
        ...(event.result.isError !== undefined
          ? { isError: event.result.isError }
          : {}),
      };
    case 'done':
      return { type: event.type, doneReason: event.reason };
    case 'error':
      return { type: event.type, isError: true };
    default:
      return { type: event.type };
  }
}
export function projectEvents(
  events: readonly AgentEvent[],
): readonly ComparableEvent[] {
  return events.map(projectToComparable);
}
export interface CallerAgentRuntimeFactories {
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly agentClientFactory?: AgentClientFactory;
  readonly taskToolRegistration?: TaskToolRegistration;
}
export function requireFixturePaths(
  paths: WorkspacePathOperations | undefined,
): WorkspacePathOperations {
  if (paths === undefined)
    throw new Error('Fixture factory requires workspace paths');
  return paths;
}
export type { Config, MessageBus };
export type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
