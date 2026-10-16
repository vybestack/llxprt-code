/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFirstLineFromFile, SessionDiscovery } from './SessionDiscovery.js';
import { scanResumeMetadata } from './resumeMetadata.js';
import { scanSessionMetadata } from './boundedSessionScan.js';
import { readMetadataJsonLines } from './metadataJsonLines.js';

const header = {
  v: 1,
  seq: 1,
  ts: '2026-09-21T00:00:00.000Z',
  type: 'session_start',
  payload: {
    sessionId: 'metadata-budget',
    projectHash: 'budget-project',
    provider: 'test',
    model: 'test',
    startTime: '2026-09-21T00:00:00.000Z',
    workspaceDirs: ['/workspace/雪', '/workspace/second'],
  },
};

let root: string;

let file: string;

describe('metadata allocation budgets through discovery and continuation', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'issue854-metadata-budget-'));
    file = join(root, 'session-metadata-budget.jsonl');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(
    'rejects an oversized selected header before constructing its directory tree',
    verifyRejectsAnOversizedSelectedHeaderBeforeConstructingItsDirectoryTree,
  );

  it.each([
    ['containers', '[' + '[],'.repeat(65535) + '[]]'],
    ['values', '[' + 'null,'.repeat(262143) + 'null]'],
  ])(
    'propagates the %s diagnostic before delivering corrupted metadata',
    async (dimension, tree) => {
      await writeFile(
        file,
        JSON.stringify(header) +
          '\n' +
          '{"v":1,"seq":2,"type":"directories_changed","payload":{"directories":' +
          tree +
          '}}\n',
      );
      const size = (await stat(file)).size;
      const diagnostic = new RegExp(`Journal metadata ${dimension} limit`);
      await expect(
        scanResumeMetadata(file, 'budget-project', size),
      ).rejects.toThrow(diagnostic);
      const scan = await scanSessionMetadata(file, 'budget-project', null);
      if (scan.ok) throw new Error('Corrupted metadata was accepted');
      expect(scan.error).toMatch(diagnostic);
      const result = await SessionDiscovery.listContinueTargetsDetailedBounded(
        root,
        'budget-project',
      );
      expect(result).toHaveProperty('targets.length', 0);
    },
  );

  it(
    'preserves legacy workspace metadata in real discovery and continuation',
    verifyPreservesLegacyWorkspaceMetadataInRealDiscoveryAndContinuation,
  );

  it(
    'resets the allocation budget for each line instead of limiting session length',
    verifyResetsTheAllocationBudgetForEachLineInsteadOfLimitingSessionLength,
  );
});

async function verifyRejectsAnOversizedSelectedHeaderBeforeConstructingItsDirectoryTree(): Promise<void> {
  const text = JSON.stringify(header).replace(
    JSON.stringify(header.payload.workspaceDirs),
    '[' + '[],'.repeat(65535) + '[]]',
  );
  await writeFile(file, text + '\n');
  expect(await readFirstLineFromFile(file)).toBeNull();
  const result = await SessionDiscovery.listContinueTargetsDetailedBounded(
    root,
    'budget-project',
  );
  expect(result).toHaveProperty('targets.length', 0);
}

async function verifyPreservesLegacyWorkspaceMetadataInRealDiscoveryAndContinuation(): Promise<void> {
  await writeFile(file, JSON.stringify(header) + '\n');
  const discovered = await SessionDiscovery.listContinueTargetsDetailedBounded(
    root,
    'budget-project',
  );
  expect(discovered).toHaveProperty('targets.length', 1);
  const result = await scanResumeMetadata(
    file,
    'budget-project',
    (await stat(file)).size,
  );
  expect(result.replay).toHaveProperty('metadata.workspaceDirs', [
    '/workspace/雪',
    '/workspace/second',
  ]);
  expect(await readFirstLineFromFile(file)).toHaveProperty('workspaceDirs', [
    '/workspace/雪',
    '/workspace/second',
  ]);
}

async function verifyResetsTheAllocationBudgetForEachLineInsteadOfLimitingSessionLength(): Promise<void> {
  const directories = '[' + '"/workspace",'.repeat(150000) + '"/last"]';
  await writeFile(
    file,
    JSON.stringify(header) +
      '\n' +
      [2, 3]
        .map(
          (seq) =>
            `{"v":1,"seq":${seq},"type":"directories_changed","payload":{"directories":${directories}}}\n`,
        )
        .join(''),
  );
  let count = 0;
  for await (const line of readMetadataJsonLines(file)) {
    expect(line.parsed).not.toBeNull();
    count += 1;
  }
  expect(count).toBe(3);
}
