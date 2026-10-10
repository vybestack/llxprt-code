/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReplayResult } from '@vybestack/llxprt-code-core';
import type { SessionInfo } from '../agent.js';

export function sessionInfoFromReplay(
  id: string,
  replay: Extract<ReplayResult, { ok: true }>,
  modifiedAt: string,
): SessionInfo {
  return {
    id,
    name: replay.sessionName ?? null,
    title: replay.metadata.title,
    createdAt: replay.metadata.startTime,
    modifiedAt,
    ...(replay.ancestry === undefined
      ? {}
      : {
          parentSessionId: replay.ancestry.parentSessionId,
          parentSequence: replay.ancestry.parentSequence,
          checkpointId: replay.ancestry.checkpointId,
          checkpointName: replay.ancestry.checkpointName,
        }),
  };
}
