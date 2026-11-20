/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { basename } from 'node:path';
import type { SessionControl } from '../../control/sessionControl.js';

import { readJournalFileFacts } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

export async function recordedRows(
  path: string,
  projectHash: string,
): Promise<readonly IContent[]> {
  const found = await readJournalFileFacts(path);
  if (found === undefined || found.facts.start.projectHash !== projectHash)
    throw new Error('Missing fixture session or mismatched project');
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

export function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}
