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
