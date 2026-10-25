/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  checkpointKey,
  isCheckpointKey,
  parseCheckpointEntry,
} from './checkpointDescriptor.js';
import { JournalFormatError } from './errors.js';
import type { CommitAck, JournalGroupWriter } from './groupWriter.js';
import type { TrailerState } from './groupWriter.js';
import { GroupCopier, type CopyShared } from './groupCopier.js';
import type { IdKeyHasher } from './idKeys.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import {
  createJournal,
  type JournalOpenDependencies,
} from './journalWriterOpen.js';
import type { IdTrieNode } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { KeyedMapReader } from './keyedMap.js';
import { readMapEntries, readValueBody, type MapEntry } from './mapEntries.js';
import type { JournalFileHandle } from './positionalFile.js';
import { OFFSET } from './offsetFields.js';
import { createRecordAccess, type RecordAccess } from './recordAccess.js';
import {
  emptyCopyStats,
  remapOffset,
  type CopyStats,
} from './recordTransfer.js';
import { MUTATION } from './recordKinds.js';
import { RelocationIndex, type RelocationStats } from './relocationIndex.js';
import { copyStateMap, type StatePolicy } from './stateTransfer.js';
import { TRAILER_RECORD_BYTES } from './trailerRecord.js';
import { readVersionAt } from './trailerAccess.js';
import type { Version } from './version.js';

/** What a copy needs besides the source: how to create the new file and how ids hash in it. */
export interface CopyDependencies {
  readonly journal: JournalOpenDependencies;
  readonly hasher: IdKeyHasher;
}

/** A version in the new file. */
export interface CopiedVersion {
  /** Where its trailer was in the source. */
  readonly sourceOffset: number;
  /** Where its trailer is in the new file. */
  readonly offset: number;
  readonly commitSeq: number;
}

export interface CopyResult {
  readonly path: string;
  /** The versions in the order they were written; the last is the one the caller asked for. */
  readonly versions: readonly CopiedVersion[];
  readonly stats: CopyStats;
  readonly relocation: RelocationStats;
}

/** Called after each version is written, for a caller that watches a copy. */
export type CopyObserver = (copied: CopiedVersion) => Promise<void> | void;

/**
 * The trailer of a copied version (design 4.8): the new roots, the source's
 * labels and counts, no ancestors and a lineage of its own.
 */
async function copyTrailerState(
  copier: GroupCopier,
  version: Version,
  policy: StatePolicy,
  shared: CopyShared,
  kept: Pick<Version, 'commitSeq' | 'groupTag'> | undefined,
): Promise<TrailerState> {
  const { roots } = version;
  const rowRoot = await remapOffset(OFFSET.trailerRowRoot, roots.rowRoot, (o) =>
    copier.copyRowNode(o),
  );
  const idRoot = await remapOffset(OFFSET.trailerIdRoot, roots.idRoot, (o) =>
    copier.copyIdNode(o, copier.factValue),
  );
  const metaRoot = await remapOffset(
    OFFSET.trailerMetaRoot,
    roots.metaRoot,
    (o) => copier.copyIdNode(o, copier.metaValue),
  );
  const state = await copyStateMap(
    copier,
    roots.stateRoot,
    policy,
    shared.sourceCache,
  );
  const lastRowOffset = await remapOffset(
    OFFSET.trailerLastRow,
    version.lastRowOffset,
    (o) => copier.resolveLastRow(o),
  );
  const none = (old: number): Promise<number> =>
    remapOffset(OFFSET.trailerSkip, old, async () => 0);
  return {
    commitSeq: kept?.commitSeq,
    groupTag: kept?.groupTag,
    parent: await remapOffset(
      OFFSET.trailerParent,
      version.parent,
      async () => 0,
    ),
    skip: [
      await none(version.skip[0]),
      await none(version.skip[1]),
      await none(version.skip[2]),
    ],
    lineage: BigInt(kept?.commitSeq ?? 1),
    lineageDepth: 0,
    mutation: MUTATION.clone,
    mutationArg0: 0n,
    mutationArg1: 0n,
    rowRoot,
    idRoot,
    metaRoot,
    stateRoot: state.root,
    nextLabel: version.nextLabel,
    firstLabel: version.firstLabel,
    lastRowOffset,
    lastOwner: version.lastOwner,
    ckptBytes: state.ckptBytes,
    rootAggregate: version.aggregate,
    slots: version.slots,
  };
}

interface VersionJob {
  readonly version: Version;
  readonly policy: StatePolicy;
  /** Keep the version's own `commitSeq` and `groupTag` (compaction) or take the next sequence and a new tag (clone). */
  readonly keepIdentity: boolean;
  /** Whether a version follows, which may share records with this one. */
  readonly recording: boolean;
}

class CopySession {
  readonly stats = emptyCopyStats();
  readonly versions: CopiedVersion[] = [];
  private readonly shared: CopyShared;
  private readonly copiedNodes = new BoundedIdNodeCache();
  /** The new file is readable up to here: the end of the last version written. */
  private writtenEnd = 0;

  constructor(
    private readonly writer: JournalGroupWriter,
    readonly source: RecordAccess,
    private readonly path: string,
    deps: CopyDependencies,
    private readonly observer: CopyObserver | undefined,
  ) {
    this.shared = {
      source,
      relocation: new RelocationIndex(path, writer.reader, deps.hasher),
      stats: this.stats,
      sourceCache: new BoundedIdNodeCache(),
      readCopiedNode: (offset) => this.readCopiedNode(offset),
    };
  }

  private readCopiedNode(offset: number): Promise<IdTrieNode> {
    const access = createRecordAccess(this.path, this.writer.reader, {
      selfOffset: 0,
      durableEnd: this.writtenEnd,
    });
    return new IdTrieReader(access, this.copiedNodes).readNode(offset);
  }

  get relocation(): RelocationIndex {
    return this.shared.relocation;
  }

  get sourceCache(): IdNodeCache {
    return this.shared.sourceCache;
  }

  /** Writes one version as a commit group of its own. */
  async copyVersion(job: VersionJob): Promise<CopiedVersion> {
    const { version } = job;
    const ack: CommitAck = await this.writer.commitStreamedGroup(
      async (appender) => {
        const copier = new GroupCopier(this.shared, appender, job.recording);
        return copyTrailerState(
          copier,
          version,
          job.policy,
          this.shared,
          job.keepIdentity ? version : undefined,
        );
      },
    );
    this.shared.relocation.detach();
    this.writtenEnd = ack.durableEnd;
    const copied: CopiedVersion = {
      sourceOffset: version.selfOffset,
      offset: ack.durableEnd - TRAILER_RECORD_BYTES,
      commitSeq: ack.commitSeq,
    };
    if (job.recording) {
      await this.shared.relocation.record(version.selfOffset, copied.offset);
    }
    this.versions.push(copied);
    this.stats.copied.TRAILER += 1;
    this.stats.bytes += TRAILER_RECORD_BYTES;
    await this.observer?.(copied);
    return copied;
  }

  result(path: string): CopyResult {
    return {
      path,
      versions: this.versions,
      stats: this.stats,
      relocation: this.shared.relocation.written,
    };
  }
}

async function withNewFile(
  path: string,
  source: RecordAccess,
  deps: CopyDependencies,
  observer: CopyObserver | undefined,
  work: (session: CopySession) => Promise<void>,
): Promise<CopyResult> {
  const writer = await createJournal(path, deps.journal);
  try {
    const session = new CopySession(writer, source, path, deps, observer);
    await work(session);
    return session.result(path);
  } finally {
    await writer.close();
  }
}

/** A finished copy in a file with no name, and the descriptor that is the only way to reach it. */
export interface UnlinkedCopy {
  readonly result: CopyResult;
  readonly handle: JournalFileHandle;
}

/**
 * `withNewFile` for a file with no name: closing its descriptor would delete
 * the file, so on success the descriptor is handed to the caller open.
 */
async function withKeptUnlinkedFile(
  path: string,
  source: RecordAccess,
  deps: CopyDependencies,
  observer: CopyObserver | undefined,
  work: (session: CopySession) => Promise<void>,
): Promise<UnlinkedCopy> {
  const writer = await createJournal(path, deps.journal);
  let kept: UnlinkedCopy;
  try {
    const session = new CopySession(writer, source, path, deps, observer);
    await work(session);
    kept = { result: session.result(path), handle: writer.detach() };
  } catch (error) {
    await writer.close();
    throw error;
  }
  await writer.close();
  return kept;
}

/**
 * Clones one version into a new file (design 4.8): the rows, id facts, meta
 * map and state map it reaches, with every offset remapped. The new file holds
 * one version, in a lineage of its own, and the checkpoints, mirror link and
 * release queue of the source are not carried. Memory is the depth of the
 * trees plus one batch.
 */
export function cloneVersion(
  source: RecordAccess,
  version: Version,
  path: string,
  deps: CopyDependencies,
  observer?: CopyObserver,
): Promise<CopyResult> {
  return withNewFile(path, source, deps, observer, async (session) => {
    await session.copyVersion({
      version,
      policy: 'portable',
      keepIdentity: false,
      recording: false,
    });
  });
}

/**
 * The version a checkpoint entry names, unless an earlier version of this copy
 * already carried it (a checkpoint can be named by two keys).
 */
async function unrelocatedCheckpoint(
  source: RecordAccess,
  session: CopySession,
  entry: MapEntry,
): Promise<Version | undefined> {
  const descriptor = parseCheckpointEntry(
    await readValueBody(source, entry.head),
  );
  if (descriptor === undefined) return undefined;
  if (
    (await session.relocation.lookup(descriptor.trailerOffset)) !== undefined
  ) {
    return undefined;
  }
  const version = await readVersionAt(source, descriptor.trailerOffset);
  if (version.commitSeq !== descriptor.commitSeq) {
    throw new JournalFormatError(
      `Checkpoint ${entry.key} says commitSeq ${descriptor.commitSeq}, the trailer at ${descriptor.trailerOffset} has ${version.commitSeq}`,
    );
  }
  return version;
}

/**
 * The copy of compaction (design 4.11 steps 3 and 4): every checkpoint version
 * the current state map names, then the current version, in one new file. The
 * versions are copied one at a time. A record that several share is copied
 * once, found through the relocation trie by the versions after it. A
 * checkpoint version keeps its `commitSeq` and carries a state map of its own;
 * the current version keeps its `commitSeq` too, and its state map names the
 * new trailers of the checkpoints. The checkpoints are taken in the order of
 * their keys' hashes, so the commit sequences along the file are not
 * ascending, and the current version, written last, is the one with the
 * highest.
 */
export function compactionCopy(
  source: RecordAccess,
  current: Version,
  path: string,
  deps: CopyDependencies,
  observer?: CopyObserver,
): Promise<CopyResult> {
  return withNewFile(path, source, deps, observer, (session) =>
    copyLiveVersions(session, source, current),
  );
}

/**
 * `compactionCopy` into a file with no name (the bare store). `path` only
 * labels the copy; `deps.journal.open` makes the file, and the descriptor
 * comes back open.
 */
export function compactionCopyUnlinked(
  source: RecordAccess,
  current: Version,
  path: string,
  deps: CopyDependencies,
  observer?: CopyObserver,
): Promise<UnlinkedCopy> {
  return withKeptUnlinkedFile(path, source, deps, observer, (session) =>
    copyLiveVersions(session, source, current),
  );
}

async function copyLiveVersions(
  session: CopySession,
  source: RecordAccess,
  current: Version,
): Promise<void> {
  for await (const entry of readMapEntries(
    source,
    session.sourceCache,
    current.roots.stateRoot,
  )) {
    if (isCheckpointKey(entry.key)) {
      const version = await unrelocatedCheckpoint(source, session, entry);
      if (version !== undefined) {
        await session.copyVersion({
          version,
          policy: 'portable',
          keepIdentity: true,
          recording: true,
        });
      }
    }
  }
  await session.copyVersion({
    version: current,
    policy: 'retained',
    keepIdentity: true,
    recording: false,
  });
}

/**
 * Restores a checkpoint the way the product does (design 4.9): a clone of the
 * saved version into a child file. The checkpoint is named by id in the state
 * map of `current`.
 */
export async function cloneCheckpoint(
  source: RecordAccess,
  current: Version,
  id: string,
  path: string,
  deps: CopyDependencies,
  observer?: CopyObserver,
): Promise<CopyResult> {
  const reader = new KeyedMapReader(
    source,
    new BoundedIdNodeCache(),
    'state',
    deps.hasher,
  );
  const stored = await reader.get(current.roots.stateRoot, checkpointKey(id));
  const descriptor =
    stored === undefined ? undefined : parseCheckpointEntry(stored);
  if (descriptor === undefined) {
    throw new JournalFormatError(
      `There is no checkpoint ${JSON.stringify(id)}`,
    );
  }
  const version = await readVersionAt(source, descriptor.trailerOffset);
  if (version.commitSeq !== descriptor.commitSeq) {
    throw new JournalFormatError(
      `Checkpoint ${id} says commitSeq ${descriptor.commitSeq}, the trailer at ${descriptor.trailerOffset} has ${version.commitSeq}`,
    );
  }
  return cloneVersion(source, version, path, deps, observer);
}
