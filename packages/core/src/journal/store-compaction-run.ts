/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { cancellableAccess } from './cancellable-access.js';
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
import { COMPACTION_REARM_BYTES, removeStaleCompaction } from './compaction.js';
import type { JournalGroupWriter } from './groupWriter.js';
import type { RecordAccess } from './recordAccess.js';
import type { Version } from './version.js';
import type { JournalStoreDependencies } from './journalStore.js';

export async function compactStoreFile(seams: {
  readonly signal?: AbortSignal;
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
  const { path, unlinked, writer, version, deps, fileOperations, signal } =
    seams;
  const access = cancellableAccess(seams.access, signal);
  if (unlinked) {
    const candidate = await writeUnlinkedCompactionCandidate(
      path,
      access,
      version,
      deps.journal,
      deps.idDeps.hasher,
    );
    if (signal?.aborted === true) {
      await candidate.handle.close();
      signal.throwIfAborted();
    }
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
  if (signal?.aborted === true) {
    await removeStaleCompaction(path);
    signal.throwIfAborted();
  }
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

/** Only automatic maintenance is cancelled; explicit compaction remains a drain. */
export class AutomaticCompaction {
  private readonly controller = new AbortController();
  running: Promise<SwapOutcome> | undefined;

  cancel(): void {
    this.controller.abort();
  }

  run(
    copy: (signal: AbortSignal | undefined) => Promise<SwapOutcome>,
    automatic: boolean,
  ): Promise<SwapOutcome> {
    const running = this.execute(copy, automatic);
    this.running = running;
    return running.finally(() => {
      this.running = undefined;
    });
  }

  private async execute(
    copy: (signal: AbortSignal | undefined) => Promise<SwapOutcome>,
    automatic: boolean,
  ): Promise<SwapOutcome> {
    if (!automatic) return copy(undefined);
    const { signal } = this.controller;
    if (signal.aborted) return 'refused';
    try {
      return await copy(signal);
    } catch (error) {
      if (this.cancelled(error)) return 'refused';
      throw error;
    }
  }

  private cancelled(error: unknown): boolean {
    const { signal } = this.controller;
    return signal.aborted && error === signal.reason;
  }
}
