/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * A checkpoint can be taken while a replacement is open, so the journal prefix
 * copied into a fork may end inside that transaction. The child's recorder
 * must close it before the first record it writes, or the child's next
 * replacement nests inside it and every reader rejects the child.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PROJECT_HASH,
  commitReplacement,
  newRecorder,
  recordInterruptedReplace,
  recordTypesOf,
  row,
  textOf,
  viaDurableFold,
  viaResolver,
  type InterruptedReplaceOptions,
} from './__tests__/support/crashedReplaceFixture.js';
import { CONTINUE_LATEST, resumeSession } from './resumeSession.js';
import {
  SessionTransitionService,
  type ForkResult,
} from './SessionTransitionService.js';

const roots: string[] = [];
const forks: ForkResult[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

interface Fork {
  readonly child: ForkResult;
  readonly childDir: string;
  readonly childFile: string;
}

/**
 * Fork a checkpoint taken after `before` ran against a live source recorder.
 * The child lives in its own directory so a second resume finds only it.
 */
async function forkCheckpoint(
  before: (source: ReturnType<typeof newRecorder>) => Promise<void>,
): Promise<Fork> {
  const sourceDir = await tempDir('fork-replace-source-');
  const childDir = await tempDir('fork-replace-child-');
  const source = newRecorder(sourceDir);
  let checkpoint: Awaited<ReturnType<typeof source.createCheckpoint>>;
  try {
    await before(source);
    checkpoint = await source.createCheckpoint('point');
    await source.flush();
  } finally {
    await source.dispose();
  }
  const sourceFile = source.getFilePath();
  if (sourceFile === null) throw new Error('source has no journal');
  const stat = await fs.stat(sourceFile);
  const child = await new SessionTransitionService().forkFromCheckpoint(
    {
      kind: 'checkpoint',
      checkpointId: checkpoint.checkpointId,
      checkpointName: checkpoint.name,
      sequence: checkpoint.sequence,
      source: {
        sessionId: source.getSessionId(),
        filePath: sourceFile,
        projectHash: PROJECT_HASH,
        startTime: stat.mtime.toISOString(),
        lastModified: stat.mtime,
        fileSize: stat.size,
        provider: 'openai',
        model: 'gpt-4.1',
        kind: 'main',
      },
    },
    childDir,
    PROJECT_HASH,
    'openai',
    'gpt-4.1',
    [childDir],
  );
  if (!child.ok) throw new Error(child.error);
  forks.push(child);
  const childFile = child.recording.getFilePath();
  if (childFile === null) throw new Error('child has no journal');
  return { child, childDir, childFile };
}

async function secondResumeRows(childDir: string): Promise<string[]> {
  const resumed = await resumeSession({
    continueRef: CONTINUE_LATEST,
    projectHash: PROJECT_HASH,
    chatsDir: childDir,
    currentProvider: 'openai',
    currentModel: 'gpt-4.1',
    workspaceDirs: [childDir],
  });
  if (!resumed.ok) throw new Error(resumed.error);
  const rows: string[] = [];
  try {
    for await (const content of resumed.boot.streamRows())
      rows.push(textOf(content));
  } finally {
    await resumed.boot.close();
    await resumed.recording.dispose();
  }
  return rows;
}

async function finishChild(fork: Fork): Promise<void> {
  forks.splice(forks.indexOf(fork.child), 1);
  await fork.child.boot.close();
  await fork.child.recording.dispose();
}

function checkpointInsideReplacement(
  options: InterruptedReplaceOptions,
): (source: ReturnType<typeof newRecorder>) => Promise<void> {
  return (source) => recordInterruptedReplace(source, options);
}

describe('forkFromCheckpoint with a replacement in flight', () => {
  afterEach(async () => {
    for (const fork of forks.splice(0)) {
      await fork.boot.close();
      await fork.recording.dispose();
    }
    for (const root of roots.splice(0))
      await fs.rm(root, { recursive: true, force: true });
  });

  for (const taggedRows of [[], ['abandoned-0', 'abandoned-1']]) {
    it(`replaces readably when the checkpoint falls inside a replacement with ${taggedRows.length} tagged rows`, async () => {
      const fork = await forkCheckpoint(
        checkpointInsideReplacement({ taggedRows }),
      );

      await commitReplacement(fork.child.recording, ['child replacement']);
      await finishChild(fork);

      expect({
        resolver: await viaResolver(fork.childFile),
        durableFold: await viaDurableFold(fork.childFile),
        secondResume: await secondResumeRows(fork.childDir),
      }).toStrictEqual({
        resolver: ['child replacement'],
        durableFold: ['child replacement'],
        secondResume: ['child replacement'],
      });
    });
  }

  it('closes the copied transaction before the fork record', async () => {
    const fork = await forkCheckpoint(
      checkpointInsideReplacement({ taggedRows: ['abandoned'] }),
    );
    await fork.child.recording.flush();

    const types = await recordTypesOf(fork.childFile);
    const begin = types.indexOf('replace_begin');
    expect(types.slice(begin)).toStrictEqual([
      'replace_begin',
      'content',
      'replace_abort',
      'session_forked',
    ]);
    expect(await viaResolver(fork.childFile)).toStrictEqual(['old']);
    const streamed: string[] = [];
    for await (const content of fork.child.boot.streamRows())
      streamed.push(textOf(content));
    expect(streamed).toStrictEqual(['old']);
  });

  it('adds no abort when the checkpoint precedes the replacement', async () => {
    const fork = await forkCheckpoint(async (source) => {
      await source.commit('content', { content: row('old', 1) });
    });
    const types = await recordTypesOf(fork.childFile);
    expect(types).not.toContain('replace_abort');

    await commitReplacement(fork.child.recording, ['child replacement']);
    await finishChild(fork);

    expect(await viaResolver(fork.childFile)).toStrictEqual([
      'child replacement',
    ]);
    expect(await secondResumeRows(fork.childDir)).toStrictEqual([
      'child replacement',
    ]);
  });

  it('adds no abort when the replacement committed before the checkpoint', async () => {
    const fork = await forkCheckpoint(
      checkpointInsideReplacement({ taggedRows: ['new-0'], commit: true }),
    );

    expect(await recordTypesOf(fork.childFile)).not.toContain('replace_abort');
    await commitReplacement(fork.child.recording, ['after']);
    await finishChild(fork);

    expect(await viaResolver(fork.childFile)).toStrictEqual(['after']);
    expect(await viaDurableFold(fork.childFile)).toStrictEqual(['after']);
    expect(await secondResumeRows(fork.childDir)).toStrictEqual(['after']);
  });
});
