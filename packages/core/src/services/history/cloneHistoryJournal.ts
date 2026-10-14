/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { scanResumeMetadata } from '../../recording/resumeMetadata.js';
import { createScratchDir } from '../../storage/scratch-root.js';

export async function cloneHistoryJournal(
  source: SessionRecordingService,
  isCancelled: () => boolean,
): Promise<{
  recorder: SessionRecordingService;
  directory: string;
  byteOffset: number;
}> {
  await source.flush();
  const directory = await createScratchDir('llxprt-history-');
  const recorder = new SessionRecordingService({
    sessionId: `history-${randomUUID()}`,
    projectHash: source.getProjectHash(),
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'history-service',
    model: 'local',
  });
  try {
    const sourcePath = source.getFilePath();
    if (isCancelled()) throw new Error('History journal store is disposed');
    if (sourcePath === null) return { recorder, directory, byteOffset: 0 };
    const copiedBytes = (await stat(sourcePath)).size;
    const filePath = join(directory, 'history.jsonl');
    let byteOffset = copiedBytes;
    if (copiedBytes > 0) {
      await pipeline(
        createReadStream(sourcePath, { start: 0, end: copiedBytes - 1 }),
        createWriteStream(filePath, { flags: 'wx' }),
      );
      if ((await stat(filePath)).size !== copiedBytes)
        throw new Error(
          'History journal source was truncated during detachment',
        );
      byteOffset = await initializeFromCopy(
        recorder,
        filePath,
        source.getProjectHash(),
        copiedBytes,
      );
    }
    if (isCancelled()) throw new Error('History journal store is disposed');
    return { recorder, directory, byteOffset };
  } catch (error) {
    await recorder.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Point the recorder at the copied journal. A source copied while a
 * replacement was open ends inside that transaction; the recorder closes it
 * with a `replace_abort`, exactly as resume does, and the abort is flushed
 * here so the returned byte offset covers a journal that ends outside any
 * transaction.
 */
async function initializeFromCopy(
  recorder: SessionRecordingService,
  filePath: string,
  projectHash: string,
  copiedBytes: number,
): Promise<number> {
  const { replay } = await scanResumeMetadata(
    filePath,
    projectHash,
    copiedBytes,
  );
  if (!replay.ok)
    throw new Error(`History journal source is unreadable: ${replay.error}`);
  recorder.initializeForResume(
    filePath,
    replay.lastSeq,
    undefined,
    replay.unfinishedReplaceTxId,
  );
  if (replay.unfinishedReplaceTxId === undefined) return copiedBytes;
  await recorder.flush();
  return (await stat(filePath)).size;
}

export function removeTempDir(dir: string | null): void {
  if (dir === null) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Temp litter is harmless; never mask a dispose outcome with cleanup.
  }
}
