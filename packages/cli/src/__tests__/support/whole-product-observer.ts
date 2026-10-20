/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { getProjectHash, type IContent } from '@vybestack/llxprt-code-core';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import {
  readJournalFileFacts,
  readJournalCheckpoints,
} from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import {
  SESSION_KEYS,
  decodeSessionFact,
} from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';

export async function activePath(agent: Agent): Promise<string> {
  const path = await lockedRecordingPath(agent);
  const history = agent.agentClient.getHistoryService();
  if (history === null) throw new Error('Missing live history owner');
  expect(history.journalPath()).toBe(path);
  return path;
}

export async function lockedRecordingPath(agent: Agent): Promise<string> {
  await agent.session.flushRecording();
  const path = agent.session.getRecording().path;
  if (path === undefined) throw new Error('Missing native recording');
  expect(path.endsWith('.llxj')).toBe(true);
  expect(
    await SessionLockManager.isLocked(
      dirname(path),
      agent.session.getSessionId(),
    ),
  ).toBe(true);
  return path;
}

export async function nativeRows(path: string): Promise<readonly IContent[]> {
  const session = await JournalSession.open(path);
  const rows: IContent[] = [];
  try {
    for await (const row of session.rows()) rows.push(row.content);
    return rows;
  } finally {
    await session.close();
  }
}

export async function nativeFact(path: string, key: string): Promise<unknown> {
  const session = await JournalSession.open(path);
  try {
    const value = await session.store.getState(key);
    return value === undefined ? undefined : decodeSessionFact(value);
  } finally {
    await session.close();
  }
}

export async function verifyFacts(
  path: string,
  id: string,
  root: string,
  title: string | null = 'W24 durable lifecycle',
  directories: readonly string[] = [root],
): Promise<void> {
  const facts = await readJournalFileFacts(path);
  if (facts === undefined) throw new Error('Missing session facts');
  expect(facts.facts).toMatchObject({
    sessionId: id,
    provider: 'fake',
    model: 'fake-model',
    title,
    directories,
    start: {
      projectHash: getProjectHash(root),
      workspaceDirs: directories,
      kind: 'main',
    },
  });
  expect(facts.rows).toBe((await nativeRows(path)).length);
}

export async function verifyCheckpoint(path: string): Promise<void> {
  const checkpoints = await readJournalCheckpoints(path);
  expect(checkpoints.map((checkpoint) => checkpoint.name)).toStrictEqual([
    'w24-cut',
  ]);
  expect(checkpoints[0].sequence).toBeGreaterThan(0);
}

export async function verifyFork(path: string): Promise<void> {
  expect(await nativeFact(path, SESSION_KEYS.fork)).toMatchObject({
    parentSessionId: 'w24-source',
    checkpointName: 'w24-cut',
  });
}

export async function verifyReleased(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const facts = await readJournalFileFacts(path);
    if (facts === undefined) throw new Error('Missing released session facts');
    expect(
      await SessionLockManager.isLocked(dirname(path), facts.facts.sessionId),
    ).toBe(false);
  }
}

export async function recordingArtifacts(path: string): Promise<void> {
  const projectEntries = await readdir(dirname(dirname(path)), {
    recursive: true,
  });
  expect(
    projectEntries.filter((entry) => entry.endsWith('.json')),
  ).toStrictEqual([]);
  const entries = await readdir(dirname(path));
  expect(
    entries.filter(
      (entry) => !entry.endsWith('.llxj') && !entry.endsWith('.lock'),
    ),
  ).toStrictEqual([]);
}

export async function finalArtifacts(paths: readonly string[]): Promise<void> {
  const directory = dirname(paths[0]);
  expect((await readdir(directory)).sort()).toStrictEqual(
    paths.map((path) => path.slice(directory.length + 1)).sort(),
  );
}

export async function lifecycleReceipt(
  root: string,
  paths: readonly string[],
): Promise<void> {
  const recordings = [];
  for (const path of paths) {
    const facts = await readJournalFileFacts(path);
    const checkpoints = await readJournalCheckpoints(path);
    recordings.push({ path, facts, checkpoints });
  }
  await writeFile(
    `${root}/lifecycle-proof.json`,
    JSON.stringify({ pid: process.pid, recordings }, null, 2) + '\n',
  );
}
