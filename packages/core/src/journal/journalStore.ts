/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  checkpointKey,
  parseCheckpointEntry,
  type CheckpointDescriptor,
} from './checkpointDescriptor.js';
import { listCheckpoints, type ListedCheckpoint } from './checkpointList.js';
import { JournalFormatError } from './errors.js';
import {
  COMPACTION_REARM_BYTES,
  compactionDue,
  removeStaleCompaction,
} from './compaction.js';
import {
  CompactionSwap,
  realFileOperations,
  type FileOperations,
  type SwapOutcome,
} from './compactionSwap.js';
import { buildGroup, mapReader, type BuildContext } from './groupBuild.js';
import type { OccurrencePlanner, VersionEdit } from './groupEdits.js';
import { mutationOf, planGroup } from './groupPlan.js';
import type { GroupPlan, PlanContext } from './groupPlanTypes.js';
import type { CommitAck } from './groupWriter.js';
import type { JournalGroupWriter } from './groupWriter.js';
import { IdFactQueries, type IdFactDeps } from './idFactQueries.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import {
  createJournal,
  openJournalForOwner,
  type JournalOpenDependencies,
} from './journalWriterOpen.js';
import { FIRST_NEXT_LABEL } from './labels.js';
import { LineageChain, loadChain } from './lineageChain.js';
import { createRecordAccess, type RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import type { RightSpine, RowTreeAlgebra } from './rowTreeBuilder.js';
import {
  iterateRowEntries,
  loadRightSpine,
  type RowTreeRootRef,
} from './rowTreeReader.js';
import {
  readRowIds,
  readStoredRow,
  type RowIds,
  type StoredRow,
} from './rowReads.js';
import { readVersionAt } from './trailerAccess.js';
import { versionOf, type Version } from './version.js';
import { VersionSnapshot } from './versionSnapshot.js';
import { writeCompactionCandidate } from './storeCompaction.js';
import type { SlotKinds } from './aggregateComposition.js';

/** What the store is built from: the file seams, the hash, the two normalizers and the planner. */
export interface JournalStoreDependencies {
  readonly journal: JournalOpenDependencies;
  readonly idDeps: IdFactDeps;
  readonly planOccurrences: OccurrencePlanner;
  /** The aggregate algebra of the row tree for a slot table. */
  readonly algebra: (kinds: SlotKinds) => RowTreeAlgebra;
  /** One capped cache each for the id trie, the meta map and the state map. */
  readonly createCache?: () => IdNodeCache;
  /** The rename, close and open of the compaction swap (design 4.11); the real ones by default. */
  readonly fileOperations?: FileOperations;
  /** Whether the file has outgrown its version (design 4.11); a test lowers the floor through it. */
  readonly compactionDue?: (version: Version, notBefore: number) => boolean;
}

function noop(): void {
  // Settles the tail of the commit queue; the caller sees the commit's own outcome.
}

/**
 * A group that was acked, with what a reader of the group needs (design 5.2):
 * the version before and after it, reads bound to the version after, which
 * reach the version before too, and the labels of the rows whose records the
 * group wrote.
 */
export interface CommittedGroup {
  readonly ack: CommitAck;
  readonly before: Version | undefined;
  readonly after: Version;
  readonly access: RecordAccess;
  readonly writtenLabels: readonly bigint[];
}

/** The labels of the rows a group writes. A replace streams its rows, so it names none. */
function writtenLabelsOf(plan: GroupPlan): bigint[] {
  if (plan.segments === undefined) return plan.newRows.map((row) => row.label);
  const labels: bigint[] = [];
  for (const segment of plan.segments) {
    if (segment.kind === 'fresh') labels.push(segment.label);
    if (segment.kind === 'foreign') labels.push(segment.row.entry.label);
  }
  return labels;
}

interface SpineEntry {
  readonly rowRoot: number;
  readonly spine: RightSpine;
}

/**
 * One journal as a versioned store: the single writer of the file, the
 * published version, and the maps and facts that version names. Edits are
 * applied to a tentative version that exists only inside a commit group; the
 * published version moves in one place, after the group's trailer is acked
 * (design 4.1), so a version is never readable before it is durable.
 */
export class JournalStore {
  private currentVersion: Version | undefined;
  private access: RecordAccess | undefined;
  private chain: LineageChain | undefined;
  private spineEntry: SpineEntry | undefined;
  private tail: Promise<void> = Promise.resolve();
  private idCache: IdNodeCache;
  private metaCache: IdNodeCache;
  private stateCache: IdNodeCache;
  /** Commits submitted and not yet finished; compaction runs when none is waiting. */
  private queued = 0;
  /** Readers that hold a version across awaits; a swap waits for none (design 10.1). */
  private pins = 0;
  /** The file size below which the trigger is not evaluated, set after a refused swap. */
  private rearmAt = 0;
  /** The compaction in progress; a pin or a read waits for it (design 10.1). */
  private compacting: Promise<SwapOutcome> | undefined;
  private compactionFailure: { readonly error: unknown } | undefined;
  private readonly fileOperations: FileOperations;

  private constructor(
    readonly path: string,
    private readonly writer: JournalGroupWriter,
    private readonly deps: JournalStoreDependencies,
  ) {
    this.fileOperations =
      deps.fileOperations ?? realFileOperations(deps.journal.open);
    this.idCache = this.makeCache();
    this.metaCache = this.makeCache();
    this.stateCache = this.makeCache();
    this.install(writer.published?.trailer);
  }

  static async create(
    path: string,
    deps: JournalStoreDependencies,
  ): Promise<JournalStore> {
    return new JournalStore(
      path,
      await createJournal(path, deps.journal),
      deps,
    );
  }

  /**
   * Opens an existing journal for its owner; the last committed version is the
   * published one. A candidate a crashed compaction left is removed first, and
   * the trigger is evaluated once (design 4.11).
   */
  static async open(
    path: string,
    deps: JournalStoreDependencies,
  ): Promise<JournalStore> {
    await removeStaleCompaction(path);
    const { writer } = await openJournalForOwner(path, deps.journal);
    const store = new JournalStore(path, writer, deps);
    store.tail = store.compactWhenIdle();
    return store;
  }

  /** The last version whose trailer was acked, or undefined before the first group. */
  get published(): Version | undefined {
    return this.currentVersion;
  }

  /**
   * Applies the edits in order to a tentative version and commits it as one
   * group. Groups run one at a time in the order they are submitted.
   */
  commit(edits: readonly VersionEdit[]): Promise<CommitAck> {
    return this.commitDetailed(edits).then((group) => group.ack);
  }

  /** `commit`, returning the group with the versions around it, for the fan-out to mirrors (design 5.2). */
  commitDetailed(edits: readonly VersionEdit[]): Promise<CommittedGroup> {
    this.queued += 1;
    const turn = this.tail.then(() => this.runCommit(edits));
    this.tail = turn.then(noop, noop).then(() => this.afterCommit());
    return turn;
  }

  /**
   * Resolves when every commit and compaction submitted so far has finished,
   * and throws what a compaction that failed on its own threw.
   */
  async idle(): Promise<void> {
    await this.tail;
    if (this.compactionFailure !== undefined) {
      throw this.compactionFailure.error;
    }
  }

  /**
   * Holds the published version across awaits: a compaction does not run
   * while a pin is live, because it moves every record (design 4.11 and
   * 10.1). A pin asked for while a compaction runs waits for it. The returned
   * function releases the pin; calling it twice is a mistake and throws. The
   * reads of this class pin for their own duration; a caller that keeps a
   * `snapshot()`, a `recordAccess()` or a `CommittedGroup` across awaits pins.
   */
  async pin(): Promise<() => void> {
    while (this.compacting !== undefined) {
      await this.compacting.catch(noop);
    }
    this.pins += 1;
    let released = false;
    return () => {
      if (released) throw new Error('A journal pin was released twice');
      released = true;
      this.pins -= 1;
      if (this.pins === 0) {
        this.tail = this.tail.then(() => this.compactWhenIdle());
      }
    };
  }

  private async whilePinned<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.pin();
    try {
      return await work();
    } finally {
      release();
    }
  }

  /**
   * Compacts now, at the next point the commit queue is free (design 4.11).
   * Refuses while a pin is live. Resolves to `refused` when the platform
   * would not rename over the open file.
   */
  compact(): Promise<SwapOutcome> {
    if (this.pins > 0) {
      return Promise.reject(
        new Error('A journal with a live pin cannot compact'),
      );
    }
    const turn = this.tail.then(() => this.runCompaction());
    this.tail = turn.then(noop, noop);
    return turn;
  }

  async close(): Promise<void> {
    await this.tail;
    await this.writer.close();
  }

  /** A meta map entry of the published version. */
  getMeta(key: string): Promise<Uint8Array | undefined> {
    return this.whilePinned(() =>
      mapReader(this.readContext(), 'meta').get(
        this.currentVersion?.roots.metaRoot ?? 0,
        key,
      ),
    );
  }

  /** A state map entry of the published version. */
  getState(key: string): Promise<Uint8Array | undefined> {
    return this.whilePinned(() =>
      mapReader(this.readContext(), 'state').get(
        this.currentVersion?.roots.stateRoot ?? 0,
        key,
      ),
    );
  }

  /** The live checkpoints of the published version (design 4.9). */
  async *checkpoints(): AsyncGenerator<ListedCheckpoint> {
    const release = await this.pin();
    try {
      yield* listCheckpoints(
        this.requireAccess(),
        this.stateCache,
        this.currentVersion?.roots.stateRoot ?? 0,
      );
    } finally {
      release();
    }
  }

  /** One checkpoint of the published version; undefined when it does not exist or was deleted. */
  async checkpoint(id: string): Promise<CheckpointDescriptor | undefined> {
    const bytes = await this.getState(checkpointKey(id));
    return bytes === undefined ? undefined : parseCheckpointEntry(bytes);
  }

  /** Id facts of the published version. */
  idFacts(): IdFactQueries {
    const root = this.currentVersion?.roots.idRoot ?? 0;
    const reader =
      this.access === undefined
        ? undefined
        : new IdTrieReader(this.access, this.idCache);
    return new IdFactQueries(
      {
        get: async (hash) =>
          reader === undefined ? undefined : reader.lookup(root, hash),
      },
      this.deps.idDeps,
    );
  }

  /** The live rows of the published version, in label order. */
  async *rows(from = 0): AsyncGenerator<RowEntry> {
    const release = await this.pin();
    try {
      const root = this.rowRootRef();
      if (root === undefined || this.access === undefined) return;
      yield* iterateRowEntries(this.access, root, from);
    } finally {
      release();
    }
  }

  /** The published version with the reads that reach it, taken together (see `VersionSnapshot`). */
  snapshot(): VersionSnapshot {
    return new VersionSnapshot(this.currentVersion, this.access);
  }

  /** The header and raw id strings of the row an entry points at (design 4.6), without its blocks. */
  readRowIds(entry: RowEntry): Promise<RowIds> {
    return this.whilePinned(() => readRowIds(this.requireAccess(), entry));
  }

  /** The whole row an entry points at. */
  readRow(entry: RowEntry): Promise<StoredRow> {
    return this.whilePinned(() => readStoredRow(this.requireAccess(), entry));
  }

  /**
   * Reads of the records the published version reaches, for a copy of it
   * (design 4.8). Bound to the published `durableEnd`: take a new one after
   * the next commit.
   */
  recordAccess(): RecordAccess {
    return this.requireAccess();
  }

  /** The version a trailer at `offset` carries. */
  readVersion(offset: number): Promise<Version> {
    return readVersionAt(this.requireAccess(), offset);
  }

  private makeCache(): IdNodeCache {
    return (
      this.deps.createCache ?? ((): IdNodeCache => new BoundedIdNodeCache())
    )();
  }

  private async afterCommit(): Promise<void> {
    this.queued -= 1;
    await this.compactWhenIdle();
  }

  /** The idle point of design 4.11: nothing queued, no pin, the queue held by the caller. */
  private async compactWhenIdle(): Promise<void> {
    const version = this.currentVersion;
    if (
      version === undefined ||
      this.queued > 0 ||
      this.pins > 0 ||
      this.compactionFailure !== undefined
    ) {
      return;
    }
    const due = this.deps.compactionDue ?? compactionDue;
    if (!due(version, this.rearmAt)) return;
    try {
      await this.runCompaction();
    } catch (error) {
      this.compactionFailure = { error };
    }
  }

  private runCompaction(): Promise<SwapOutcome> {
    const running = this.compactOnce();
    this.compacting = running;
    return running.finally(() => {
      this.compacting = undefined;
    });
  }

  private async compactOnce(): Promise<SwapOutcome> {
    const published = this.requireVersion();
    const candidate = await writeCompactionCandidate(
      this.path,
      this.requireAccess(),
      published,
      this.deps.journal,
      this.deps.idDeps.hasher,
      this.fileOperations,
    );
    const outcome = await new CompactionSwap(
      this.writer,
      this.path,
      this.fileOperations,
    ).run(candidate);
    if (outcome === 'refused') {
      this.rearmAt = published.durableEnd + COMPACTION_REARM_BYTES;
      return outcome;
    }
    this.restartOnNewFile();
    return outcome;
  }

  /** Every offset a cache or a chain holds belongs to the old file. */
  private restartOnNewFile(): void {
    this.idCache = this.makeCache();
    this.metaCache = this.makeCache();
    this.stateCache = this.makeCache();
    this.spineEntry = undefined;
    this.chain = undefined;
    this.install(this.writer.published?.trailer);
    this.rearmAt = 0;
  }

  private async runCommit(
    edits: readonly VersionEdit[],
  ): Promise<CommittedGroup> {
    if (this.compactionFailure !== undefined) {
      throw new JournalFormatError(
        'An earlier compaction of this journal failed',
        {
          cause: this.compactionFailure.error,
        },
      );
    }
    const mutation = mutationOf(edits);
    const before = this.currentVersion;
    const plan = await planGroup(this.planContext(), edits);
    let built: Awaited<ReturnType<typeof buildGroup>> | undefined;
    const ack = await this.writer.commitStreamedGroup(async (appender) => {
      built = await buildGroup(this.buildContext(), plan, mutation, appender);
      return built.state;
    });
    const trailer = this.writer.published?.trailer;
    if (built === undefined || trailer === undefined) {
      throw new JournalFormatError('A committed group left no trailer');
    }
    this.install(trailer);
    this.chain = built.chainBase.push(trailer.selfOffset);
    if (built.spine !== undefined) {
      this.spineEntry = { rowRoot: trailer.rowRoot, spine: built.spine };
    }
    return {
      ack,
      before,
      after: this.requireVersion(),
      access: this.requireAccess(),
      writtenLabels: writtenLabelsOf(plan),
    };
  }

  private requireVersion(): Version {
    if (this.currentVersion === undefined) {
      throw new JournalFormatError('The journal has no committed group');
    }
    return this.currentVersion;
  }

  /** The only place the published version moves. */
  private install(trailer: Parameters<typeof versionOf>[0] | undefined): void {
    if (trailer === undefined) return;
    this.currentVersion = versionOf(trailer);
    this.access = createRecordAccess(this.path, this.writer.reader, trailer);
  }

  private requireAccess(): RecordAccess {
    if (this.access === undefined) {
      throw new JournalFormatError('The journal has no committed group');
    }
    return this.access;
  }

  private rowRootRef(): RowTreeRootRef | undefined {
    const version = this.currentVersion;
    return version === undefined || version.roots.rowRoot === 0
      ? undefined
      : { offset: version.roots.rowRoot, rows: version.rows };
  }

  private planContext(): PlanContext {
    return {
      access: this.access,
      published: this.currentVersion,
      readVersion: (offset) => this.readVersion(offset),
      firstNextLabel: FIRST_NEXT_LABEL,
      readState: (key) => this.getState(key),
    };
  }

  private readContext(): BuildContext {
    return this.buildContext();
  }

  private buildContext(): BuildContext {
    return {
      access: this.access,
      readGroup: (writtenEnd) =>
        createRecordAccess(this.path, this.writer.reader, {
          selfOffset: this.currentVersion?.selfOffset ?? 0,
          durableEnd: writtenEnd,
        }),
      published: this.currentVersion,
      hasher: this.deps.idDeps.hasher,
      idDeps: this.deps.idDeps,
      planOccurrences: this.deps.planOccurrences,
      idCache: this.idCache,
      metaCache: this.metaCache,
      stateCache: this.stateCache,
      algebra: this.deps.algebra,
      spineFor: (version) => this.spineFor(version),
      chainFor: (parent) => this.chainFor(parent),
      commitSeq: (this.currentVersion?.commitSeq ?? 0) + 1,
    };
  }

  private async spineFor(version: Version): Promise<RightSpine> {
    if (this.spineEntry?.rowRoot === version.roots.rowRoot) {
      return this.spineEntry.spine;
    }
    const spine = await loadRightSpine(this.requireAccess(), {
      offset: version.roots.rowRoot,
      rows: version.rows,
    });
    this.spineEntry = { rowRoot: version.roots.rowRoot, spine };
    return spine;
  }

  private async chainFor(parent: Version | undefined): Promise<LineageChain> {
    if (parent === undefined) return LineageChain.NONE;
    const held = this.chain?.truncatedTo(parent.lineageDepth);
    if (held?.offsetAtDepth(parent.lineageDepth) === parent.selfOffset) {
      return held;
    }
    return loadChain((offset) => this.readVersion(offset), parent);
  }
}
