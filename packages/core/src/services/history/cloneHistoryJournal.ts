/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { readMetadataJsonLines } from '../../recording/metadataJsonLines.js';
import { field } from '../../recording/resolverProjection.js';
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
    const byteOffset = (await stat(sourcePath)).size;
    const filePath = join(directory, 'history.jsonl');
    if (byteOffset > 0) {
      await pipeline(
        createReadStream(sourcePath, { start: 0, end: byteOffset - 1 }),
        createWriteStream(filePath, { flags: 'wx' }),
      );
      if ((await stat(filePath)).size !== byteOffset)
        throw new Error(
          'History journal source was truncated during detachment',
        );
      recorder.initializeForResume(
        filePath,
        await lastSequence(filePath, byteOffset),
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

async function lastSequence(
  filePath: string,
  byteOffset: number,
): Promise<number> {
  let lastSeq = 0;
  for await (const line of readMetadataJsonLines(filePath, byteOffset)) {
    const seq = field(line.parsed, 'seq');
    if (typeof seq === 'number') lastSeq = seq;
  }
  return lastSeq;
}

export function removeTempDir(dir: string | null): void {
  if (dir === null) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Temp litter is harmless; never mask a dispose outcome with cleanup.
  }
}
