/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SessionControl,
  type SessionControlDeps,
} from './control/sessionControl.js';
import { createAgentSessionPersistence } from './control/recordedHistoryPersistence.js';
import type { AgentProviderState } from './agentImpl.js';
import {
  seedAgentAuthState,
  type AgentAuthState,
} from './control/authState.js';

export function initializeProviderState(
  state: Parameters<typeof initialProviderState>[0],
  initialAuth: Parameters<typeof seedAgentAuthState>[0],
  authState: AgentAuthState,
): AgentProviderState {
  const selection = initialProviderState(state);
  seedAgentAuthState(initialAuth, authState, selection, state.provider);
  return selection;
}

export function initialProviderState(
  state: Pick<AgentProviderState, 'provider' | 'model' | 'baseUrl'> & {
    readonly modelParams?: Readonly<Record<string, unknown>>;
  },
): AgentProviderState {
  return {
    provider: state.provider,
    model: state.model,
    modelParams: structuredClone(state.modelParams ?? {}),
    baseUrl: state.baseUrl,
  };
}

import type { Agent } from './agent.js';
import type { AgentExecutionCoordinator } from './agentExecutionCoordinator.js';

export function idleClient(
  operations: Agent['sessionClient'],
  coordinator: Pick<AgentExecutionCoordinator, 'withIdleBoundary'>,
  rebuild: () => void,
): Agent['sessionClient'] {
  return {
    ...operations,
    refreshAuth: (method) =>
      coordinator.withIdleBoundary(async () => {
        await operations.refreshAuth(method);
        rebuild();
      }),
  };
}

export async function resetIdleChat(
  coordinator: Pick<AgentExecutionCoordinator, 'withIdleBoundary'>,
  session: Pick<Agent['session'], 'getRecording' | 'clearHistory'>,
  reset: () => Promise<void>,
): Promise<void> {
  await coordinator.withIdleBoundary(() =>
    session.getRecording().enabled ? session.clearHistory() : reset(),
  );
}

export function assembleSessionControl(
  config: SessionControlDeps['config'],
  mediaStore: SessionControlDeps['mediaStore'] | undefined,
  operations: Omit<SessionControlDeps, 'config' | 'mediaStore' | 'persistence'>,
): SessionControl {
  const store = mediaStore ?? operations.resolveClient().mediaStore;
  if (store === undefined)
    throw new Error('Agent client requires explicit media store');
  return new SessionControl({
    ...operations,
    config,
    mediaStore: store,
    persistence: createAgentSessionPersistence(
      config.storageRoot,
      config.projectChatsDir,
      store,
      config.getSessionPersistenceQueueByteLimit(),
    ),
  });
}
