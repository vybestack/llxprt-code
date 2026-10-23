import type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSchedulerFactory } from '../../config-types.js';
import { createTaskRegistration } from '../../runtimeFactories.js';
import { stripSandboxSegment } from './fixtureRoot.js';

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
export type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
export type { Config, MessageBus };

export function createCallerTaskRegistration(
  config: Config,
  settings: SessionSettingsOwner,
  messageBus: MessageBus,
): TaskToolRegistration {
  return createTaskRegistration(config, {
    messageBus,
    readTaskPolicy: () => settings.readTaskPolicy(),
    readGovernance: () => settings.readToolGovernance([]),
    launchChild: async () => {
      throw new Error(
        'This adoption scenario does not supply child definitions',
      );
    },
  });
}
