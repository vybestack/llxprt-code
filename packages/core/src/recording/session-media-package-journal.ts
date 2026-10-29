/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { open, stat, type FileHandle } from 'node:fs/promises';
import { createFileHandleSink } from '../journal/positionalFile.js';
import { JournalSession } from '../services/history/journalSession.js';
import type { IContent } from '../services/history/IContent.js';
import {
  SESSION_KEYS,
  encodeSessionFact,
  readSessionFacts,
} from './sessionMetaKeys.js';
import {
  boundedReadChanged,
  HASH_CHUNK_BYTES,
  requirePortableMediaContent,
  type PinnedPackageFile,
} from './session-media-package-validation.js';
import { scanJournalRecording } from './journal-recording-scan.js';

export function validateJournalRecording(
  path: string,
  onContents: (contents: readonly IContent[]) => void,
): Promise<PinnedPackageFile> {
  return scanJournalRecording(path, (contents) => {
    onContents(contents.map(requirePortableMediaContent));
  });
}

async function copyJournalBytes(
  input: FileHandle,
  output: FileHandle,
  size: number,
): Promise<{ total: number; sha256: string }> {
  const sink = createFileHandleSink(output, 0);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let total = 0;
  for (;;) {
    const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > size) throw new Error('Packaged journal changed during read');
    const chunk = buffer.subarray(0, bytesRead);
    hash.update(chunk);
    await sink(chunk);
  }
  return { total, sha256: hash.digest('hex') };
}

async function streamPinnedJournal(
  source: PinnedPackageFile,
  outputPath: string,
): Promise<PinnedPackageFile> {
  const path = source.path;
  const input = await open(path, 'r');
  try {
    const before = await input.stat();
    if (!before.isFile()) throw new Error('Packaged journal is not a file');
    const output = await open(outputPath, 'wx', 0o600);
    try {
      const { total, sha256 } = await copyJournalBytes(
        input,
        output,
        before.size,
      );
      if (
        boundedReadChanged(before, await input.stat(), await stat(path), total)
      ) {
        throw new Error('Packaged journal changed during read');
      }
      const pinned = { path, byteLength: total, sha256 };
      if (source.byteLength !== total || source.sha256 !== pinned.sha256) {
        throw new Error('Packaged journal changed after validation');
      }
      return pinned;
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

export async function writeImportedJournal(
  source: PinnedPackageFile,
  outputPath: string,
  projectHash: string,
  sessionId: string,
): Promise<void> {
  await streamPinnedJournal(source, outputPath);
  const session = await JournalSession.open(outputPath);
  try {
    const facts = await readSessionFacts((key) => session.store.getState(key));
    if (facts === undefined)
      throw new Error('Packaged journal has no session facts');
    const { cwd: _cwd, ...start } = facts.start;
    await session.store.commit([
      {
        kind: 'setState',
        key: SESSION_KEYS.id,
        value: encodeSessionFact(sessionId),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.start,
        value: encodeSessionFact({ ...start, projectHash, workspaceDirs: [] }),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.directories,
        value: encodeSessionFact([]),
      },
    ]);
  } finally {
    await session.close();
  }
}
