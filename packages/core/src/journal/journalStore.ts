/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { journalLabelSorter } from './ordered-labels.js';
import {
  readContextSpans,
  type ContextSpan,
  type ContextSpanPolicy,
} from './contextSpanFacts.js';
import { pinnedFormatPreparation } from './pinned-format-fill.js';
import {
  fillToolRanking,
  warmToolRanking,
  toolRankingPolicy,
  type ToolRankingPolicy,
} from './tool-ranking-fill.js';
import {
  fillDensityFiles,
  warmDensityFiles,
  densityFilePolicy,
} from './density-file-fill.js';
import type { DensityFilePolicy } from './density-file-facts.js';
import type { RecencyFactPolicy } from './recencyFacts.js';
import {
  fillNativeFacts,
  requireNativeFactWriter,
  warmNativeFacts,
} from './nativeFactFill.js';
import type { NativeFactIndexRegistration } from './nativeFactIndex.js';
import {
  checkpointKey,
  parseCheckpointEntry,
  type CheckpointDescriptor,
} from './checkpointDescriptor.js';
import { listCheckpoints, type ListedCheckpoint } from './checkpointList.js';
import { JournalFormatError } from './errors.js';
import {
  effectAppender,
  rollbackEffect,
  type CommitEffectFactory,
} from './commitEffect.js';
import {
  COMPACTION_REARM_BYTES,
  compactionDue,
  removeStaleCompaction,
} from './compaction.js';
import {
  CompactionSwap,
  realFileOperations,
  swapInUnlinkedCandidate,
  type FileOperations,
  type SwapOutcome,
} from './compactionSwap.js';
import { mapReader, type BuildContext, type BuiltGroup } from './groupBuild.js';
import type { CommitEffect } from './commitEffect.js';
import type { OccurrencePlanner, VersionEdit } from './groupEdits.js';
import type { RecordAppender } from './groupAppender.js';
import { prepareBuild } from './preparedGroup.js';
import type { GroupPlan, PlanContext } from './groupPlanTypes.js';
import type { CommitAck, JournalGroupWriter } from './groupWriter.js';
import type { IdFactDeps } from './idFactQueries.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import {
  createJournal,
  openJournalForOwner,
  type JournalOpenDependencies,
} from './journalWriterOpen.js';
import { FIRST_NEXT_LABEL } from './labels.js';
import { LineageChain, loadChain } from './lineageChain.js';
import {
  createRecordAccess,
  groupReadAccess,
  type RecordAccess,
} from './recordAccess.js';
import { PinLease, PinnedRead } from './pinLease.js';
import { JournalMediaPins } from './journalMediaPins.js';
import { PinnedIdFacts } from './pinnedIdFacts.js';
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
import { genesisVersion, versionOf, type Version } from './version.js';
import { VersionSnapshot } from './versionSnapshot.js';
import {
  writeCompactionCandidate,
  writeUnlinkedCompactionCandidate,
} from './storeCompaction.js';
import type { SlotKinds } from './aggregateComposition.js';
import {
  invalidateAnthropicFormats,
  requireIncrementalFormats,
} from './formatFillLifecycle.js';
import {
  fillRowFormats,
  warmRowFormat,
  type RegisteredRowFormat,
} from './formatFill.js';

/** What the store is built from: the file seams, the hash, the two normalizers and the planner. */
export interface JournalStoreDependencies {
  readonly journal: JournalOpenDependencies;
  readonly idDeps: IdFactDeps;
  readonly planOccurrences: OccurrencePlanner;
  readonly recencyFactPolicy?: RecencyFactPolicy;
  readonly contextSpanPolicy?: ContextSpanPolicy;
  /** The aggregate algebra of the row tree for a slot table. */
  readonly algebra: (kinds: SlotKinds) => RowTreeAlgebra;
  /** One capped cache each for the id trie, the meta map and the state map. */
  readonly createCache?: () => IdNodeCache;
  /** The rename, close and open of the compaction swap (design 4.11); the real ones by default. */
  readonly fileOperations?: FileOperations;
  /** Whether the file has outgrown its version (design 4.11); a test lowers the floor through it. */
  readonly compactionDue?: (version: Version, notBefore: number) => boolean;
}

/** What a store with no file name is called in its errors. */
export const UNLINKED_JOURNAL_LABEL = '(unlinked journal)';

function noop(): void {
  // Settles the tail of the commit queue; the caller sees the commit's own outcome.
}

/**
 * A group that was acked, with what a reader of the group needs (design 5.2):
 * the version before and after it, reads bound to the version after, which
 * reach the version before too, and the labels of the rows whose records the
 * group wrote. The reads hold a pin from the moment the group is acked, so a
 * compaction cannot move the group's records before its reader is done;
 * `close` releases it (and `commit` closes it at once).
 */
export interface CommittedGroup {
  readonly ack: CommitAck;
  readonly before: Version | undefined;
  readonly after: Version;
  readonly read: PinnedRead;
  readonly writtenLabels: readonly bigint[];
  readonly resolvedEdits?: readonly VersionEdit[];
  readonly streamedAppend?: boolean;
  readonly unchanged?: boolean;
  close(): void | Promise<void>;
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
  private rowFormats: readonly RegisteredRowFormat[] = [];
  private factIndex: NativeFactIndexRegistration | undefined;
  private toolRanking: ToolRankingPolicy | undefined;
  private densityFiles: DensityFilePolicy | undefined;
  private commitEffect: CommitEffectFactory | undefined;

  setCommitEffect(factory: CommitEffectFactory): void {
    this.commitEffect = factory;
  }

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
  private closing = false;
  /** Readers that hold a version across awaits; a swap waits for none (design 10.1). */
  private pins = 0;
  readonly mediaPins = new JournalMediaPins();

  /** A compaction was due but a pin held it off; the last pin released evaluates the trigger again. */
  private deferredByPin = false;
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
    /** The file has no name: `path` is a label, and a compaction swaps descriptors instead of renaming. */
    private readonly unlinked = false,
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
   * A new journal in a file with no name (design 4.12). `deps.journal.open`
   * makes the file and ignores the path, which is only the label the store
   * goes by.
   */
  static async createUnlinked(
    deps: JournalStoreDependencies,
  ): Promise<JournalStore> {
    return new JournalStore(
      UNLINKED_JOURNAL_LABEL,
      await createJournal(UNLINKED_JOURNAL_LABEL, deps.journal),
      deps,
      true,
    );
  }

  /**
   * A new store in a file with no name that holds the published version of
   * this one (design 4.8): the streaming copy of compaction, so the copy keeps
   * the commit sequence, the labels and the checkpoints. The source is pinned
   * for the copy, so no compaction moves it, and stays as it was. `open` makes
   * the nameless file.
   */
  async cloneUnlinked(
    open: JournalOpenDependencies['open'],
  ): Promise<JournalStore> {
    const deps = { ...this.deps, journal: { ...this.deps.journal, open } };
    const candidate = await this.whilePinned(() =>
      writeUnlinkedCompactionCandidate(
        UNLINKED_JOURNAL_LABEL,
        this.requireAccess(),
        this.requireVersion(),
        deps.journal,
        deps.idDeps.hasher,
      ),
    );
    let clone: JournalStore;
    try {
      clone = await JournalStore.createUnlinked(deps);
    } catch (error) {
      await candidate.handle.close();
      throw error;
    }
    await swapInUnlinkedCandidate(
      clone.writer,
      clone.fileOperations,
      candidate,
    );
    clone.restartOnNewFile();
    clone.rowFormats = this.rowFormats;
    clone.factIndex = this.factIndex;
    clone.densityFiles = this.densityFiles;
    return clone;
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
    return this.commitDetailed(edits).then(async (group) => {
      await group.close();
      return group.ack;
    });
  }

  /**
   * `commit`, returning the group with the versions around it, for the fan-out
   * to mirrors (design 5.2). The group holds a pin until the caller closes it.
   */
  commitDetailed(edits: readonly VersionEdit[]): Promise<CommittedGroup> {
    return this.enqueueCommit(() => this.runCommit(edits));
  }

  private async enqueueCommit<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error('The journal store is closed');
    this.queued += 1;
    const turn = this.tail.then(run);
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
  async pin(): Promise<() => void | Promise<void>> {
    const read = await this.openRead();
    return () => read.close();
  }

  /**
   * The published version with the reads that reach its records, pinned until
   * the returned read is closed. This and the reads built on it (`snapshot`,
   * `idFacts`, a committed group) are the only way to a `RecordAccess`.
   */
  async openRead(): Promise<PinnedRead> {
    while (this.compacting !== undefined) {
      await this.compacting.catch(noop);
    }
    if (this.closing) throw new Error('The journal store is closed');
    return this.readOfPublished();
  }

  /** Synchronous so that nothing, not even a compaction, runs between taking the pin and naming the version. */
  private readOfPublished(): PinnedRead {
    return new PinnedRead(this.currentVersion, this.access, this.newLease());
  }

  private newLease(): PinLease {
    const release = this.writer.retainReader();
    const version = this.currentVersion?.commitSeq ?? 0;
    const releaseVersion = this.mediaPins.retain(version);
    this.pins += 1;
    return new PinLease(() => {
      this.pins -= 1;
      releaseVersion();
      if (!this.closing && this.pins === 0 && this.deferredByPin) {
        this.deferredByPin = false;
        this.tail = this.tail.then(() => this.compactWhenIdle());
      }
      return this.mediaPins.afterReaderRelease(release);
    });
  }

  private async whilePinned<T>(work: () => Promise<T>): Promise<T> {
    const read = await this.openRead();
    try {
      return await work();
    } finally {
      await read.close();
    }
  }

  /**
   * Compacts now, at the next point the commit queue is free (design 4.11).
   * Refuses while a pin is live. Resolves to `refused` when the platform
   * would not rename over the open file.
   */
  compact(): Promise<SwapOutcome> {
    if (this.closing)
      return Promise.reject(new Error('The journal store is closed'));
    if (this.pins > 0 || this.mediaPins.releasePending) {
      return Promise.reject(
        new Error('A journal with a live pin cannot compact'),
      );
    }
    const turn = this.tail.then(() => this.runCompaction());
    this.tail = turn.then(noop, noop);
    return turn;
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.tail;
    await this.writer.close();
  }

  contextSpans(): ContextSpan[] {
    return readContextSpans(
      this.writer.currentFile().handle.fd,
      this.currentVersion,
      this.deps.idDeps.hasher,
      this.idCache,
    );
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
    return this.whilePinned(() => this.getStateUnpinned(key));
  }

  private getStateUnpinned(key: string): Promise<Uint8Array | undefined> {
    return mapReader(this.readContext(), 'state').get(
      this.currentVersion?.roots.stateRoot ?? 0,
      key,
    );
  }

  /** The live checkpoints of the published version (design 4.9). */
  async *checkpoints(): AsyncGenerator<ListedCheckpoint> {
    const read = await this.openRead();
    try {
      yield* listCheckpoints(
        this.requireAccess(),
        this.stateCache,
        this.currentVersion?.roots.stateRoot ?? 0,
      );
    } finally {
      await read.close();
    }
  }

  /** One checkpoint of the published version; undefined when it does not exist or was deleted. */
  async checkpoint(id: string): Promise<CheckpointDescriptor | undefined> {
    const bytes = await this.getState(checkpointKey(id));
    return bytes === undefined ? undefined : parseCheckpointEntry(bytes);
  }

  /** Id facts of the published version; close them when the queries are done (they hold a pin). */
  async idFacts(): Promise<PinnedIdFacts> {
    const read = await this.openRead();
    const root = read.version?.roots.idRoot ?? 0;
    const reader =
      read.version === undefined
        ? undefined
        : new IdTrieReader(read.access, this.idCache);
    return new PinnedIdFacts(
      {
        get: async (hash) => {
          read.requireOpen();
          return reader === undefined ? undefined : reader.lookup(root, hash);
        },
      },
      this.deps.idDeps,
      read,
    );
  }

  /** The live rows of the published version, in label order. */
  async *rows(from = 0): AsyncGenerator<RowEntry> {
    const read = await this.openRead();
    try {
      const root = this.rowRootRef();
      if (root === undefined || this.access === undefined) return;
      yield* iterateRowEntries(this.access, root, from);
    } finally {
      await read.close();
    }
  }

  /** The published version with the reads that reach it, taken together and pinned until `close` (see `VersionSnapshot`). */
  async snapshot(): Promise<VersionSnapshot> {
    const read = await this.openRead();
    return new VersionSnapshot(
      read,
      this.deps.idDeps,
      this.idCache,
      this.sortedLabels,
      this.writer.reader,
    );
  }

  readonly sortedLabels = journalLabelSorter({
    openRead: () => this.openRead(),
    enqueue: (run) => this.enqueueCommit(run),
    writer: () => this.writer,
    context: () => ({ build: this.buildContext(), plan: this.planContext() }),
    installed: () => this.install(this.writer.published?.trailer),
  });

  prepareSnapshotFormat = pinnedFormatPreparation({
    enqueue: (run) => this.enqueueCommit(run),
    writer: () => this.writer,
    context: () => ({ build: this.buildContext(), plan: this.planContext() }),
    installed: () => this.install(this.writer.published?.trailer),
  });

  restorationOf(saved: VersionSnapshot): VersionEdit {
    return saved.restorationIn(this.writer.reader);
  }

  /** The header and raw id strings of the row an entry points at (design 4.6), without its blocks. */
  readRowIds(entry: RowEntry): Promise<RowIds> {
    return this.whilePinned(() => readRowIds(this.requireAccess(), entry));
  }

  /** The whole row an entry points at. */
  readRow(entry: RowEntry): Promise<StoredRow> {
    return this.whilePinned(() => readStoredRow(this.requireAccess(), entry));
  }

  /** The version a trailer at `offset` carries. */
  readVersion(offset: number): Promise<Version> {
    return this.whilePinned(() => this.readVersionUnpinned(offset));
  }

  /** For the commit path, which runs on the tail where no compaction can run. */
  private readVersionUnpinned(offset: number): Promise<Version> {
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
      this.closing ||
      this.queued > 0 ||
      this.compactionFailure !== undefined
    ) {
      return;
    }
    const due = this.deps.compactionDue ?? compactionDue;
    if (!due(version, this.rearmAt)) return;
    if (this.pins > 0 || this.mediaPins.releasePending) {
      this.deferredByPin = true;
      return;
    }
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
    if (this.unlinked) {
      const candidate = await writeUnlinkedCompactionCandidate(
        this.path,
        this.requireAccess(),
        published,
        this.deps.journal,
        this.deps.idDeps.hasher,
      );
      const swapped = await swapInUnlinkedCandidate(
        this.writer,
        this.fileOperations,
        candidate,
      );
      this.restartOnNewFile();
      return swapped;
    }
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

  private async reuseRowFormat(
    edits: readonly VersionEdit[],
  ): Promise<CommittedGroup | undefined> {
    const before = this.currentVersion;
    const warm = await warmRowFormat(
      this.buildContext(),
      edits,
      this.rowFormats,
    );
    const facts = await warmNativeFacts(this.buildContext(), edits);
    const ranking = await warmToolRanking(this.buildContext(), edits);
    const files = await warmDensityFiles(this.buildContext(), edits);
    if (
      [warm, facts, ranking, files].every((value) => value === undefined) ||
      before === undefined
    )
      return undefined;
    if (ranking !== undefined) this.toolRanking = ranking;
    if (files !== undefined) this.densityFiles = files;
    if (warm !== undefined) this.rowFormats = warm;
    if (facts !== undefined) this.factIndex = facts;
    const read = this.readOfPublished();
    return {
      ack: {
        commitSeq: before.commitSeq,
        durableEnd: before.durableEnd,
        groupTag: before.groupTag,
      },
      before,
      after: before,
      read,
      writtenLabels: [],
      close: () => read.close(),
    };
  }

  private async fillFormats(
    built: BuiltGroup,
    appender: RecordAppender,
    edits: readonly VersionEdit[],
    facts: NativeFactIndexRegistration | undefined,
  ): ReturnType<typeof fillRowFormats> {
    const ranking = toolRankingPolicy(edits, this.toolRanking);
    const ranked = await fillToolRanking(
      this.buildContext(),
      built,
      appender,
      edits,
      ranking,
    );
    const withFiles = await fillDensityFiles(
      this.buildContext(),
      ranked,
      appender,
      edits,
      densityFilePolicy(edits, this.densityFiles),
    );
    const indexed = await fillNativeFacts(
      this.buildContext(),
      withFiles,
      appender,
      facts,
      edits,
    );
    return fillRowFormats(
      this.buildContext(),
      indexed.invalidated
        ? invalidateAnthropicFormats(indexed.built)
        : indexed.built,
      appender,
      edits,
      this.rowFormats,
      indexed.invalidated,
      facts?.scope,
    );
  }

  private async nativeFactRegistration(
    edits: readonly VersionEdit[],
  ): Promise<NativeFactIndexRegistration | undefined> {
    requireIncrementalFormats(
      edits,
      this.rowFormats,
      this.currentVersion?.slots,
    );
    const edit = edits.find((item) => item.kind === 'factIndex');
    const registration =
      edit?.kind === 'factIndex' ? edit.registration : this.factIndex;
    await requireNativeFactWriter(this.buildContext(), edits, registration);
    return registration;
  }

  private assertCompactionUsable(): void {
    if (this.compactionFailure !== undefined)
      throw new JournalFormatError(
        'An earlier compaction of this journal failed',
        { cause: this.compactionFailure.error },
      );
  }

  private async runCommit(
    edits: readonly VersionEdit[],
  ): Promise<CommittedGroup> {
    this.assertCompactionUsable();
    const before = this.currentVersion;
    const warm = await this.reuseRowFormat(edits);
    if (warm !== undefined) return warm;
    let resolvedEdits = edits;
    let streamedAppend: boolean | undefined;
    let factIndex = this.factIndex;
    let plan: GroupPlan | undefined;
    let built: BuiltGroup | undefined;
    const effect = this.commitEffect?.({
      read: this.buildContext().readGroup,
      getState: (key) => this.getStateUnpinned(key),
    });
    let ack: CommitAck | undefined;
    let rowFormats = this.rowFormats;
    try {
      ack = await this.writer.prepareGroup(async (appender) => {
        try {
          const prepared = await prepareBuild(
            this.buildContext(),
            this.planContext(),
            edits,
            appender,
            effect === undefined ? appender : effectAppender(appender, effect),
            (actual) => this.nativeFactRegistration(actual),
          );
          ({ plan, built, edits: resolvedEdits, facts: factIndex } = prepared);
          streamedAppend = prepared.streamedAppend;
          if (built === undefined) {
            await effect?.settle(false);
            return undefined;
          }
          const filled = await this.finishBuilt(
            built,
            appender,
            resolvedEdits,
            factIndex,
            effect,
          );
          built = filled.built;
          rowFormats = filled.registered;
          return built.state;
        } catch (error) {
          return rollbackEffect(effect, error);
        }
      });
    } catch (error) {
      return rollbackEffect(effect, error);
    }
    if (ack === undefined) return this.unchangedGroup();
    const trailer = this.writer.published?.trailer;
    if (built === undefined || trailer === undefined || plan === undefined) {
      throw new JournalFormatError('A committed group left no trailer');
    }
    this.install(trailer);
    this.rowFormats = rowFormats;
    this.factIndex = factIndex;
    this.toolRanking = toolRankingPolicy(resolvedEdits, this.toolRanking);
    this.densityFiles = densityFilePolicy(resolvedEdits, this.densityFiles);
    this.chain = built.chainBase.push(trailer.selfOffset);
    if (built.spine !== undefined) {
      this.spineEntry = { rowRoot: trailer.rowRoot, spine: built.spine };
    }
    await effect?.settle(true);
    // Pinned before anything else can run, so no compaction separates the ack from its reader.
    const read = this.readOfPublished();
    return {
      ack,
      before,
      after: this.requireVersion(),
      read,
      writtenLabels: streamedAppend === true ? [] : writtenLabelsOf(plan),
      resolvedEdits,
      streamedAppend,
      close: () => read.close(),
    };
  }

  private async finishBuilt(
    built: BuiltGroup,
    appender: RecordAppender,
    edits: readonly VersionEdit[],
    facts: NativeFactIndexRegistration | undefined,
    effect: CommitEffect | undefined,
  ): ReturnType<typeof fillRowFormats> {
    const filled = await this.fillFormats(built, appender, edits, facts);
    if (effect === undefined) return filled;
    return {
      ...filled,
      built: {
        ...filled.built,
        state: {
          ...filled.built.state,
          stateRoot: await effect.finish(
            filled.built.state.stateRoot,
            appender,
          ),
        },
      },
    };
  }

  private unchangedGroup(): CommittedGroup {
    const read = this.readOfPublished();
    const after = this.currentVersion ?? genesisVersion(FIRST_NEXT_LABEL);
    return {
      ack: {
        commitSeq: after.commitSeq,
        durableEnd: after.durableEnd,
        groupTag: after.groupTag,
      },
      before: this.currentVersion,
      after,
      read,
      writtenLabels: [],
      unchanged: true,
      close: () => read.close(),
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
    this.access = createRecordAccess(
      this.path,
      this.writer.reader,
      trailer,
      true,
    );
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
      readVersion: (offset) => this.readVersionUnpinned(offset),
      firstNextLabel: FIRST_NEXT_LABEL,
      readState: (key) => this.getStateUnpinned(key),
    };
  }

  private readContext(): BuildContext {
    return this.buildContext();
  }

  private buildContext(): BuildContext {
    return {
      sortedLabels: this.sortedLabels,
      measureFormats: this.rowFormats.length > 0,
      access: this.access,
      readGroup: groupReadAccess(this.path, this.writer, this.currentVersion),
      published: this.currentVersion,
      hasher: this.deps.idDeps.hasher,
      idDeps: this.deps.idDeps,
      planOccurrences: this.deps.planOccurrences,
      recencyFactPolicy: this.deps.recencyFactPolicy,
      contextSpanPolicy: this.deps.contextSpanPolicy,
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
    return loadChain((offset) => this.readVersionUnpinned(offset), parent);
  }
}
