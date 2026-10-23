/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import type { AgentSessionControl } from '@vybestack/llxprt-code-agents';
import {
  bindOwnerBrowserCatalog,
  type BrowserTargetDeleter,
  type BrowserCatalogReader,
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
  readRawCatalog: BrowserCatalogReader,
  deleteRawTarget: BrowserTargetDeleter,
) {
  const currentSessionId = location.getSessionId();
  const readBrowserCatalog = useMemo(
    () =>
      owner === 'agent'
        ? bindOwnerBrowserCatalog(
            () => session.listBrowserTargetsDetailed(),
            () => session.getRecording().path,
            () => currentSessionId,
          )
        : readRawCatalog,
    [session, owner, currentSessionId, readRawCatalog],
  );
  const deleteBrowserTarget = useMemo<BrowserTargetDeleter>(
    () =>
      owner === 'agent'
        ? async (target) => {
            if (target.kind === 'checkpoint')
              await session.deleteCheckpoint(target.checkpointId);
            else await session.deleteSession(target.session.sessionId);
          }
        : deleteRawTarget,
    [session, owner, deleteRawTarget],
  );
  return { readBrowserCatalog, deleteBrowserTarget };
}
