/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  writeCompactionCandidate,
  writeUnlinkedCompactionCandidate,
} from './storeCompaction.js';
import {
  CompactionSwap,
  swapInUnlinkedCandidate,
  type FileOperations,
  type SwapOutcome,
} from './compactionSwap.js';
import { COMPACTION_REARM_BYTES } from './compaction.js';
import type { JournalGroupWriter } from './groupWriter.js';
import type { RecordAccess } from './recordAccess.js';
import type { Version } from './version.js';
import type { JournalStoreDependencies } from './journalStore.js';

export async function compactStoreFile(seams: {
  readonly path: string;
  readonly unlinked: boolean;
  readonly writer: JournalGroupWriter;
  readonly access: RecordAccess;
  readonly version: Version;
  readonly deps: JournalStoreDependencies;
  readonly fileOperations: FileOperations;
  readonly restart: () => void;
  readonly rearm: (value: number) => void;
}): Promise<SwapOutcome> {
  const { path, unlinked, writer, access, version, deps, fileOperations } =
    seams;
  if (unlinked) {
    const candidate = await writeUnlinkedCompactionCandidate(
      path,
      access,
      version,
      deps.journal,
      deps.idDeps.hasher,
    );
    const swapped = await swapInUnlinkedCandidate(
      writer,
      fileOperations,
      candidate,
    );
    seams.restart();
    return swapped;
  }
  const candidate = await writeCompactionCandidate(
    path,
    access,
    version,
    deps.journal,
    deps.idDeps.hasher,
    fileOperations,
  );
  const outcome = await new CompactionSwap(writer, path, fileOperations).run(
    candidate,
  );
  if (outcome === 'refused') {
    seams.rearm(version.durableEnd + COMPACTION_REARM_BYTES);
    return outcome;
  }
  seams.restart();
  return outcome;
}
