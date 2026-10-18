/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { basename } from 'node:path';
import type { SessionControl } from '../../control/sessionControl.js';
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';
import { replaySession } from '@vybestack/llxprt-code-core';
import { isJournalFileName } from '@vybestack/llxprt-code-core/recording/sessionFileExtension.js';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export async function recordedRows(
  path: string,
  projectHash: string,
): Promise<readonly IContent[]> {
  if (!isJournalFileName(path)) {
    const replay = await replaySession(path, projectHash);
    if (!replay.ok) throw new Error(replay.error);
    return replay.history;
  }
  let observed: readonly IContent[] = [];
  await collectJournalFileRowsForAssertions(path, (rows) => {
    observed = [...rows];
  });
  return observed;
}

export async function verifyCheckpointFlush(
  control: SessionControl,
  projectRoot: string,
  expected: readonly IContent[],
): Promise<void> {
  if (selectBackend() === 'old') {
    await expect(control.createCheckpoint('must-flush')).rejects.toThrow(
      /EEXIST|ENOTDIR/,
    );
  } else {
    const checkpoint = await control.createCheckpoint('must-flush');
    expect(
      (await control.listCheckpoints()).map((item) => item.checkpointId),
    ).toContain(checkpoint.checkpointId);
    const path = control.getRecording().path;
    if (path === undefined) throw new Error('Missing recording');
    const persisted = await recordedRows(path, basename(projectRoot));
    expect(persisted.map((row) => row.blocks)).toStrictEqual(
      expected.map((row) => row.blocks),
    );
  }
}

export function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}
