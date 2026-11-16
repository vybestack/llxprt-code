/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  replaySession,
  type LocalMediaStore,
  type RecordingIntegration,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import {
  foldToolScriptEvents,
  type ToolScriptRunView,
} from '../../code-mode/tool-script-card.js';

/**
 * The code mode script runs recorded in the active session file (issue
 * #4084), folded for display. A resumed session continues appending to the
 * file it resumed, so this covers runs from before and after the resume. A
 * session with no recording, or one that has not written its file yet, has
 * no recorded runs. Nothing here touches model history.
 */
export async function readRecordedToolScriptRuns(
  recording: SessionRecordingService | null,
  integration: RecordingIntegration | null,
  projectHash: string,
  mediaStore: LocalMediaStore,
): Promise<readonly ToolScriptRunView[]> {
  await integration?.flushAtTurnBoundary();
  const path = recording?.getFilePath() ?? null;
  if (path === null) return [];
  const replay = await replaySession(path, projectHash, { mediaStore });
  if (!replay.ok) throw new Error(replay.error);
  return foldToolScriptEvents(replay.toolScriptEvents);
}
