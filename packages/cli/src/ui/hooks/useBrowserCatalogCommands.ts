/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getProjectHash } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import { useMemo } from 'react';
import type { AgentSessionControl } from '@vybestack/llxprt-code-agents';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import {
  bindOwnerBrowserCatalog,
  bindRawBrowserCatalog,
  bindRawBrowserTargetDelete,
  type BrowserTargetDeleter,
} from './browserCatalogHost.js';

export function useBrowserCatalogCommands(
  session: Pick<
    AgentSessionControl,
    | 'listBrowserTargetsDetailed'
    | 'getRecording'
    | 'deleteCheckpoint'
    | 'deleteSession'
  >,
  owner: 'agent' | 'raw' | undefined,
  location: {
    getProjectTempDir(): string;
    getProjectRoot(): string;
    getSessionId(): string;
  },
  recording: Pick<RecordingSwapCallbacks, 'getCurrentRecording'> | undefined,
  mediaStore: LocalMediaStore | undefined,
) {
  const chatsDir = join(location.getProjectTempDir(), 'chats');
  const projectHash = getProjectHash(location.getProjectRoot());
  const currentSessionId = location.getSessionId();
  const readBrowserCatalog = useMemo(
    () =>
      owner === 'agent'
        ? bindOwnerBrowserCatalog(
            () => session.listBrowserTargetsDetailed(),
            () => session.getRecording().path,
            () => currentSessionId,
          )
        : bindRawBrowserCatalog(
            chatsDir,
            projectHash,
            () => currentSessionId,
            mediaStore,
          ),
    [session, owner, chatsDir, projectHash, currentSessionId, mediaStore],
  );
  const deleteBrowserTarget = useMemo<BrowserTargetDeleter>(
    () =>
      owner === 'agent'
        ? async (target) => {
            if (target.kind === 'checkpoint')
              await session.deleteCheckpoint(target.checkpointId);
            else await session.deleteSession(target.session.sessionId);
          }
        : bindRawBrowserTargetDelete(
            chatsDir,
            projectHash,
            () => recording?.getCurrentRecording() ?? null,
            mediaStore,
          ),
    [session, owner, chatsDir, projectHash, recording, mediaStore],
  );
  return { readBrowserCatalog, deleteBrowserTarget };
}
