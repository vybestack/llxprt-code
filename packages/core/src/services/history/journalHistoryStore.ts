/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { EntryFill, VersionEdit } from '../../journal/groupEdits.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import {
  checkedPositions,
  inheritingDraft,
  labelsAt,
  publishClear,
  spansAfterClear,
  type PositionedContent,
  type PositionedOrigin,
  type PositionedOwner,
} from './journalHistoryEdits.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type {
  HistoryCompensationMark,
  HistoryStorePort,
  HistoryClearRequest,
  HistoryJournalOp,
  HistoryMutationMark,
  HistoryProfileReplacementRequest,
  HistoryPublicationScope,
  HistoryDensityRequest,
  HistoryMergeRequest,
  HistoryRemoveTailRequest,
  HistoryRepairRequest,
  HistoryResumeRequest,
  ProfileCandidateRows,
  StagedProfileAdoption,
} from './historyStorePort.js';
import { stageProfileReplacementOnJournal } from './journalProfileReplacement.js';
import type { ConversationStatistics } from './curationDebugLogger.js';
import type { ContextRange, RemovedInteriorSpan } from './historyEventTypes.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import type { HistoryRowView } from './historyRowView.js';
import {
  contextBoundaryOf,
  contextRangeOf,
  withRowView,
  withVersionSnapshot,
  lastContentOf,
  lastTurnMarkerOf,
  streamSnapshotRows,
  statisticsOf,
  type ContextBoundary,
} from './journalScalars.js';
import type { HistorySuffixQuery } from './historyJournalRows.js';
import {
  adoptOnto,
  type AdoptionHost,
  type JournalAdoption,
} from './journalAdoption.js';
import { JournalMirrors } from './journalMirrors.js';
import { RecordingPrimary } from './recording-primary.js';
import { JournalOwners, type ResolvedOwner } from './journalOwners.js';
import {
  committedBatchSource,
  type CommittedBatchRowSource,
} from './journalBatchSource.js';
import {
  JournalCheckpointLifetime,
  withCheckpointOnJournal,
  withRollbackCheckpointOnJournal,
} from './journalCheckpoints.js';
import { planToolPairingRepair } from './journalHistoryRepair.js';
import { optimizeDensityOnJournal } from './journalDensity.js';
import { mergeOnJournal } from './journalMerge.js';
import { publishDetachedOnJournal } from './journalPublishDetached.js';
import { waitForDetachedCapture } from './journalDetachedCapture.js';
import {
  reconcileMediaOnJournal,
  removeTailOnJournal,
} from './journalMediaMutations.js';
import type {
  DetachedHistoryHost,
  DetachedHistoryOptions,
  DetachedHistoryTask,
} from './detachedHistoryMutation.js';
import type { HistoryCheckpointRows } from './historyCheckpointRows.js';
import type { JournalSession } from './journalSession.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import {
  encodedRows,
  JournalPublication,
  originChangeEdits,
  ownerChangeEdits,
  type EditBuilder,
  JournalCompensationMark,
} from './journalPublication.js';
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import { requireJournalRecorder } from './recorderBackend.js';
import { adoptResumeOnJournal } from '../../recording/journalResumeAdoption.js';
import { previewOfContent } from '../../recording/sessionMetaKeys.js';
import { PendingRecorderWrites } from './pendingRecorderWrites.js';
import { SessionPreviews } from './sessionPreviews.js';
import type { ResumePoint } from '../../recording/journalResume.js';
import { applyOperation, type JournalWriteHost } from './journalOps.js';
import type { CurrentTurnMarker } from './historyChronology.js';

/** The published repair owns its original version's pin until `close`. */
export interface JournalRepair {
  readonly inserted: IContent[];
  rollback(): Promise<void>;
  close(): void | Promise<void>;
}

/** Opens the journal a store keeps its rows in; it must yield an empty journal. */
export type JournalSessionOpener = () => Promise<JournalSession>;

export interface JournalHistoryStoreOptions {
  /** Bound as a mirror right after the journal is open (decision D-W7-3). */
  readonly recording?: JournalRecordingService;
  /** Observes every row the stream and batch readers decode (WIRING G9). */
  readonly counters?: JournalReadCounters;
}

/** What opening the journal builds: the file and the bookkeeping over it. */
interface OpenJournal {
  readonly session: JournalSession;
  readonly owners: JournalOwners;
  readonly mirrors: JournalMirrors;
}

/**
 * The history of one session on a journal (design 4.1). Operations are
 * accepted synchronously and run one at a time in the order they arrive, each
 * as its own commit group on the version the previous one published. The row
 * count is the only state answered before an ack: it is the tentative count
 * of the queue, and every ack checks it against the version it published. No
 * row is held here: reads go to the file one row at a time.
 *
 * The first failure of the queue is kept. It rejects `waitForDurable` and
 * every later `apply` throws it, because later operations were planned on a
 * count that no longer holds.
 *
 * Given an opener instead of a session, the store accepts operations at once:
 * opening the journal is the first step of the queue, the count starts at 0,
 * and a failure to open is the failure of the queue (decision D-W7-1).
 */
export class JournalHistoryStore implements HistoryStorePort {
  private tentativeRows = 0;
  private queue: Promise<void>;
  private failure: { readonly error: unknown; reported?: boolean } | undefined;
  private ack: CommitAck | undefined;
  private disposed = false;
  readonly checkpointLifetime = new JournalCheckpointLifetime();
  /** Dumps not yet closed: they read the file, so disposing closes them first. */
  private readonly openDumps = new Set<JournalDumpSnapshot>();
  private readonly publication = new JournalPublication();
  private journal: OpenJournal | undefined;
  /** Settles when the journal is open; rejects with the reason it could not be. */
  private readonly opened: Promise<void>;
  /** Settles when the journal is open and the recorder given at construction is bound; never rejects. */
  private readonly startup: Promise<void>;
  /** Shared by the mirrors of successive primaries, so a swap keeps the listeners. */
  private readonly retirement = new Set<() => void>();
  /** What a publication needs to queue its own groups (see journalOps.ts); every queued group is checked for a usable store. */
  readonly writes: JournalWriteHost = {
    rows: () => this.tentativeRows,
    owners: () => this.owners,
    enqueue: (rowsAfter, build) => this.enqueue(rowsAfter, build),
    offerPreview: (content, origin) => this.offerPreview(content, origin),
  };
  private adopted: JournalRecordingService | undefined;
  private boundary: bigint | undefined;
  private previews = new SessionPreviews();
  private readonly adoptedWrites = new PendingRecorderWrites();
  private readonly topology = new RecordingPrimary(this.adoptionHost());

  constructor(
    source: JournalSession | JournalSessionOpener,
    private readonly options: JournalHistoryStoreOptions = {},
  ) {
    if (typeof source === 'function') {
      this.opened = source().then((session) => this.install(session));
      this.queue = this.opened.catch((error: unknown) => {
        this.failure = { error };
      });
    } else {
      this.install(source);
      this.tentativeRows = source.store.published?.rows ?? 0;
      this.opened = Promise.resolve();
      this.queue = Promise.resolve();
    }
    this.startup = this.opened
      .then(() => this.bindStartupRecorder())
      .catch((error: unknown) => {
        this.failure ??= { error };
      });
  }

  private install(session: JournalSession): void {
    const owners = new JournalOwners(session.store);
    this.journal = {
      session,
      owners,
      mirrors: this.mirrorsOf(session, owners, this.retirement),
    };
  }

  private bindStartupRecorder(): Promise<void> {
    const { recording } = this.options;
    return recording === undefined
      ? Promise.resolve()
      : this.attachJournal(recording);
  }

  /** The open journal; before it is open, or when it could not be, the reason. */
  private requireOpen(): OpenJournal {
    if (this.journal === undefined) {
      throw (
        this.failure?.error ??
        new Error('The journal history store is not open yet')
      );
    }
    return this.journal;
  }

  private get session(): JournalSession {
    return this.requireOpen().session;
  }

  private get owners(): JournalOwners {
    return this.requireOpen().owners;
  }

  /** The per-agent mirror files bound to this history. */
  get mirrors(): JournalMirrors {
    return this.requireOpen().mirrors;
  }

  private mirrorsOf(
    session: JournalSession,
    owners: JournalOwners,
    listeners: Set<() => void>,
  ): JournalMirrors {
    return new JournalMirrors(
      session.store,
      owners,
      {
        exclusive: (task, detaching) => this.exclusive(task, detaching),
        assertUsable: () => this.assertUsable(),
      },
      listeners,
    );
  }

  /**
   * Resume onto a recorder (decision G5); see {@link adoptOnto}. The recorders
   * bound to this history move with it.
   */
  adoptJournal(
    recorder: JournalRecordingService,
    point: ResumePoint,
  ): Promise<JournalAdoption> {
    this.assertUsable();
    return this.exclusive(() =>
      adoptOnto(this.adoptionHost(), recorder, point),
    );
  }

  /** Resumes onto a journal recorder from the point its file was opened at; see {@link adoptResumeOnJournal}. */
  adoptResume(request: HistoryResumeRequest): Promise<string[]> {
    return adoptResumeOnJournal(this, request);
  }

  isAdoptingRecorder(recorder: SessionRecordingPort): boolean {
    return this.adopted === requireJournalRecorder(recorder);
  }

  /** Rows with a label below this were written by an earlier process; every reader applies it (D-S08-3). */
  get resumeBoundary(): bigint | undefined {
    return this.boundary;
  }

  private adoptionHost(): AdoptionHost {
    return {
      state: () => ({
        session: this.session,
        owners: this.owners,
        mirrors: this.mirrors,
        rows: this.tentativeRows,
        adopted: this.adopted,
        previews: this.previews,
        resumeBoundary: this.boundary,
      }),
      install: (state) => {
        this.journal = {
          session: state.session,
          owners: state.owners,
          mirrors: state.mirrors,
        };
        this.tentativeRows = state.rows;
        this.adopted = state.adopted;
        this.previews = state.previews;
        this.boundary = state.resumeBoundary;
      },
      drained: () => this.queue,
      mirrorsOf: (session, owners, listeners) =>
        this.mirrorsOf(session, owners, listeners),
    };
  }

  /** The ack of the last group that became durable. */
  get lastAck(): CommitAck | undefined {
    return this.ack;
  }

  /**
   * The file the history is recorded in: the named file of the store, else the
   * file of the recorder bound first. Null while the journal is not open and
   * for a bare store, which has neither.
   */
  journalPath(): string | null {
    const open = this.journal;
    if (open === undefined) return null;
    return open.session.named
      ? open.session.path
      : open.mirrors.firstRecorderPath();
  }

  /** A journal clear is asynchronous: the service holds its mutation queue until it settles (D-W7-5). */
  readonly clearIsAsynchronous = true;

  /** Rows once everything queued is applied; equals the published count when the queue is empty. */
  getLength(): number {
    return this.tentativeRows;
  }

  apply(op: HistoryJournalOp): void {
    this.assertUsable();
    applyOperation(this.writes, op);
  }

  /**
   * Rewrites the rows at `changes[].position` of the history under their own
   * labels and owners (a semantic media purge). Positions are those of the
   * history once everything queued is applied.
   */
  purge(changes: readonly PositionedContent[]): void {
    this.assertUsable();
    const sorted = checkedPositions(changes, this.tentativeRows);
    if (sorted.length === 0) return;
    const rows = sorted.map(({ content }) => inheritingDraft(content));
    const positions = sorted.map(({ position }) => position);
    this.enqueue(this.tentativeRows, async (snapshot) => {
      const labels = await labelsAt(snapshot, positions);
      return [
        {
          kind: 'purge',
          rows: labels.map((label, at) => ({ label, draft: rows[at] })),
        },
      ];
    });
  }

  /** Gives the rows at `changes[].position` a new owner; no row is rewritten (design 5.4). */
  changeOwners(changes: readonly PositionedOwner[]): void {
    this.assertUsable();
    const sorted = checkedPositions(changes, this.tentativeRows);
    if (sorted.length > 0)
      this.enqueue(this.tentativeRows, ownerChangeEdits(sorted));
  }

  /** Like {@link changeOwners}, naming origins; `undefined` makes the row unowned. */
  changeOwnersOf(changes: readonly PositionedOrigin[]): void {
    this.assertUsable();
    const sorted = checkedPositions(changes, this.tentativeRows);
    if (sorted.length > 0)
      this.enqueue(
        this.tentativeRows,
        originChangeEdits(sorted, () => this.owners),
      );
  }

  /** Sets entry fields of rows (design 8.2); the rows and their order do not change. */
  fill(fills: readonly EntryFill[]): void {
    this.assertUsable();
    if (fills.length === 0) return;
    this.enqueue(this.tentativeRows, () =>
      Promise.resolve([{ kind: 'fill', fills }]),
    );
  }

  /**
   * Replaces the whole history by `rows` in one group. The rows are encoded
   * as the writer pulls them, one at a time, so no encoded copy of the array
   * exists. Only the references are copied, which keeps a later edit of the
   * caller's array out of the queued group. Every row is written under
   * `origin`, unowned when it is omitted.
   */
  replaceAll(rows: readonly IContent[], origin?: string): void {
    this.assertUsable();
    const held = [...rows];
    this.enqueue(held.length, this.replaceEdits(held, origin));
  }

  /**
   * Replaces the history by the `count` rows `rows` yields, as one group
   * whose rows are pulled by the writer one at a time (design 4.5). It
   * resolves with the ack of the group's trailer and not before: that is the
   * only point at which the replacement is durable. A cancellation is honoured
   * before the group starts; once rows are being written the group runs to its
   * trailer, and the caller compensates after the ack if it still must undo it.
   */
  async replaceFrom(
    rows: Iterable<IContent> | AsyncIterable<IContent>,
    count: number,
    signal?: AbortSignal,
    origin?: string,
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(
      this.enqueueTurn(count, this.replaceEdits(rows, origin)),
    );
  }

  /**
   * Like {@link replaceFrom}, for a source whose row count is known only when
   * it ends (a transform streaming its output). The tentative count is not
   * moved when the group is queued; the ack's count becomes the length. The
   * caller must hold the store quiet around it, as the mutation FIFO does.
   */
  async replaceStreamed(
    rows: AsyncIterable<IContent>,
    signal?: AbortSignal,
    origin?: string,
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(
      this.enqueueTurn(undefined, this.replaceEdits(rows, origin)),
    );
  }

  /**
   * The streamed `replace` group of {@link replaceStreamed} over rows that
   * are already encoded, so a caller can carry stored rows into the new
   * version without decoding them.
   */
  async replaceDrafts(
    rows: AsyncIterable<RowDraft>,
    signal?: AbortSignal,
    ownerEdits: readonly VersionEdit[] = [],
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(
      this.enqueueTurn(undefined, () =>
        Promise.resolve([...ownerEdits, { kind: 'replace', rows }]),
      ),
    );
  }

  /**
   * The owner id of `origin` for rows a caller encodes before their group
   * exists. The edits that register a new id must go in the group that
   * writes those rows (see {@link replaceDrafts}); when no such group is
   * written the caller calls {@link discardOwnerRegistration}.
   */
  resolveOwner(origin: string | undefined): Promise<ResolvedOwner> {
    return this.owners.resolve(origin);
  }

  /** Drops an owner id {@link resolveOwner} took that no group recorded. */
  discardOwnerRegistration(): void {
    this.owners.invalidate();
  }

  /**
   * The version a detached transform reads: the queue is durable, the token
   * updates the caller still owes are settled, and nothing was queued while
   * they ran. The snapshot holds a pin: the caller closes it.
   */
  async settledSnapshot(
    settleTokens: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<VersionSnapshot> {
    await waitForDetachedCapture(() => this.waitForDurable(), signal);
    const snapshot = await this.session.store.snapshot();
    try {
      await waitForDetachedCapture(settleTokens, signal);
      await waitForDetachedCapture(() => this.waitForDurable(), signal);
      this.assertSettled(snapshot, 'captured');
    } catch (error) {
      await snapshot.close();
      throw error;
    }
    return snapshot;
  }

  /** Brackets one logical publication; the scope only counts (see {@link JournalPublication}). */
  openPublication(): HistoryPublicationScope {
    return this.publication.open();
  }

  /** Ordinals ordered rows of one publication for the token tickets, which this store does not have (G3). */
  withPublicationOrdinals(action: () => Promise<void>): Promise<void> {
    return action();
  }

  /**
   * The rows of the writer envelope that are not acked. The callers track the
   * owners of the operation they admit until its ack, and a queued group holds
   * encoded drafts only, so there is nothing further to retain.
   */
  capturePublicationOwners(): Iterable<IContent> {
    return [];
  }

  /** A version is the boundary of a mutation; there is no fold to adopt one into. */
  adoptMutationBoundary(): void {}

  mutationMark(): HistoryMutationMark {
    return this.publication.mark(this);
  }

  isCurrentMutationMark(mark: HistoryMutationMark): boolean {
    return this.publication.isCurrent(this, mark);
  }

  /**
   * Binds the file of `recorder` as the mirror of `origin`: it holds the
   * rows of that origin and the unowned ones, and every later group reaches
   * it (design 5.3).
   */
  attachJournal(
    session: SessionRecordingPort,
    replace = false,
    onAttached?: () => void,
    origin?: string,
  ): Promise<void> {
    const recorder = requireJournalRecorder(session);
    return this.opened
      .then(() =>
        this.exclusive(async () => this.topology.attach(recorder, origin)),
      )
      .then(() =>
        this.mirrors.attachRecorder(recorder, replace, onAttached, origin),
      )
      .then(() => this.previews.recordFirstFor(recorder, origin));
  }

  /**
   * Unbinds a recorder. The adopted recorder's file is the primary, so the
   * history leaves it first and the recorder may then close it (D-ORCH-11).
   */
  detachJournal(recorder: SessionRecordingPort): Promise<void> {
    const journalRecorder = requireJournalRecorder(recorder);
    return this.opened.then(() =>
      this.adopted === journalRecorder
        ? this.exclusive(
            () => this.topology.detach(this.adoptedWrites, this.failure),
            true,
          )
        : this.mirrors.detachRecorder(journalRecorder),
    );
  }

  /** Whether the recorder is bound now; a recorder given at construction is bound once the journal is open. */
  isRecorder(recorder: SessionRecordingPort): boolean {
    const journalRecorder = requireJournalRecorder(recorder);
    return (
      this.adopted === journalRecorder ||
      (this.journal?.mirrors.isRecorder(journalRecorder) ?? false)
    );
  }

  /** Resolves when every mirror has applied the groups acked so far; throws every mirror failure. */
  async settleFanout(): Promise<void> {
    await this.startup;
    await this.queue;
    await this.mirrors.flush();
  }

  primaryOriginId(): string | undefined {
    return this.journal?.mirrors.primaryOriginId();
  }

  adoptedOrigin(origin: string | undefined): void {
    this.mirrors.adoptedOrigin(origin);
  }

  onRetired(listener: () => void): () => void {
    this.retirement.add(listener);
    return () => this.retirement.delete(listener);
  }

  /** Resolves when every operation applied so far is acked; throws the first failure of the queue. */
  async waitForDurable(): Promise<void> {
    await this.startup;
    await this.queue;
    await this.adoptedWrites.settle();
    if (this.failure !== undefined) {
      this.failure.reported = true;
      throw this.failure.error;
    }
  }

  /**
   * The rows of the history once the queue is durable, as of the version
   * published at the first read; later groups do not show in a stream that
   * has started.
   */
  async *streamRows(
    query?: HistorySuffixQuery,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    signal?.throwIfAborted();
    this.assertUsable();
    await this.waitForDurable();
    const snapshot = await this.session.store.snapshot();
    yield* streamSnapshotRows(
      snapshot,
      this.boundary,
      this.options.counters,
      query,
      signal,
    );
  }

  /**
   * The last `count` rows (all rows when omitted) of the version published
   * now, as the source of a batch event. Call it once the publication it
   * announces is acked. The source holds a pin until its dispatcher retires it.
   */
  async committedBatch(count?: number): Promise<CommittedBatchRowSource> {
    const snapshot = await this.session.store.snapshot();
    try {
      return committedBatchSource(
        snapshot,
        count ?? snapshot.rows,
        this.boundary,
        this.options.counters,
      );
    } catch (error) {
      await snapshot.close();
      throw error;
    }
  }

  /**
   * The statistics of the last acked version, from its trailer; nothing is
   * read. Rows still queued are not counted (WIRING G2): a caller that needs
   * them waits for the queue first.
   */
  statistics(): ConversationStatistics {
    return statisticsOf(this.journal?.session.store.published?.aggregate);
  }

  /** The chronology boundary of the last acked version, from its trailer; see {@link statistics}. */
  contextBoundary(): ContextBoundary {
    return contextBoundaryOf(this.journal?.session.store.published?.aggregate);
  }

  /** The boundary joined with the interior spans the service accumulated (WIRING G2). */
  contextRange(accumulated: readonly RemovedInteriorSpan[]): ContextRange {
    return contextRangeOf(this.contextBoundary(), accumulated);
  }

  /**
   * The commit boundary (WIRING G11): the queue is acked and every bound
   * recorder file holds the acked groups. A recorder's own `flush()` does not
   * wait for mirror deliveries, so without the settle the rows of the last
   * turn could be missing from the session file when the next request starts.
   */
  async waitForCommit(): Promise<void> {
    await this.waitForDurable();
    await this.settleFanout();
  }

  /** The newest row, or the newest of `speaker`, once the queue is durable; nothing is kept. */
  lastContent(speaker?: IContent['speaker']): Promise<IContent | undefined> {
    return this.withDurableSnapshot((snapshot) =>
      lastContentOf(snapshot, speaker, this.boundary),
    );
  }

  currentTurnMarker(): Promise<CurrentTurnMarker | null> {
    return this.withDurableSnapshot((snapshot) =>
      lastTurnMarkerOf(snapshot, this.boundary, this.options.counters),
    );
  }

  /**
   * Row facts for a mutation, over the version durable now. The view reads the
   * file, so it holds no row, and it fails once `execute` has settled.
   */
  readRows<T>(
    execute: (view: HistoryRowView) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    return this.withDurableSnapshot((snapshot) =>
      withRowView(snapshot, this.owners, this.boundary, {
        execute,
        counters: this.options.counters,
        signal,
      }),
    );
  }

  private async withDurableSnapshot<T>(
    read: (snapshot: VersionSnapshot) => Promise<T>,
  ): Promise<T> {
    this.assertUsable();
    await this.waitForDurable();
    return withVersionSnapshot(await this.session.store.snapshot(), read);
  }

  /** Every row; for tests and tools that need the whole history, which a send never does. */
  async materialize(): Promise<IContent[]> {
    const rows: IContent[] = [];
    for await (const row of this.streamRows()) rows.push(row);
    return rows;
  }

  /** A dump of the rows once the queue is durable; it reads the file, so it holds no row. */
  async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    this.assertUsable();
    await this.waitForDurable();
    const dump: JournalDumpSnapshot = new JournalDumpSnapshot(
      await this.session.store.snapshot(),
      this.boundary,
      this.options.counters,
      () => this.openDumps.delete(dump),
    );
    this.openDumps.add(dump);
    return dump;
  }

  /**
   * Removes every row and publishes the spans the clear leaves behind. The
   * first and last chronology numbers come from the row headers of the
   * version the clear removes. It runs inside the service's mutation FIFO, so
   * no other operation is queued between the read and the rewind.
   *
   * A failing publish with rollback on puts the removed version back with
   * `restore(version)` (design 4.5) and then undoes the service's changes.
   */
  clear(request: HistoryClearRequest): Promise<void> {
    return this.withDurableSnapshot(async (snapshot) => {
      this.assertSettled(snapshot, 'cleared');
      const spans = await spansAfterClear(snapshot, request.spans);
      if (snapshot.rows > 0) {
        applyOperation(this.writes, {
          kind: 'rewind',
          itemsRemoved: snapshot.rows,
        });
        // The service publishes after the ack, so what its observers read is the emptied version.
        await this.waitForDurable();
      }
      await publishClear(request, spans, () => this.restoreTo(snapshot));
    });
  }

  /**
   * Inserts a synthetic response after every AI row whose tool calls have
   * none, and resolves once the insertions are durable. The rows come back
   * in `inserted`; they are small and few, one per unanswered call row.
   * `rollback` restores the version the repair started from, so it refuses
   * once any other group has been written.
   */
  async validateAndFix(request: HistoryRepairRequest): Promise<JournalRepair> {
    await this.waitForDurable();
    const snapshot = await this.session.store.snapshot();
    let plan: Awaited<ReturnType<typeof planToolPairingRepair>>;
    try {
      this.assertSettled(snapshot, 'repaired');
      plan = await planToolPairingRepair(
        this.session.store,
        snapshot,
        request.stamp,
      );
    } catch (error) {
      await snapshot.close();
      throw error;
    }
    if (plan.inserts.length === 0 || snapshot.version === undefined) {
      await snapshot.close();
      return {
        inserted: plan.inserted,
        rollback: async () => {},
        close: () => {},
      };
    }
    const rowsBefore = snapshot.rows;
    this.enqueue(rowsBefore + plan.inserts.length, () =>
      Promise.resolve(
        plan.inserts.map(({ afterLabel, draft }) => ({
          kind: 'insert' as const,
          afterLabel,
          draft,
        })),
      ),
    );
    await this.waitForDurable();
    const repairedAt = this.ack?.commitSeq;
    return {
      inserted: plan.inserted,
      rollback: async () => {
        if (this.ack?.commitSeq !== repairedAt) {
          throw new Error(
            'Rows were written since the repair; it cannot be rolled back',
          );
        }
        await this.restoreTo(snapshot);
      },
      close: () => snapshot.close(),
    };
  }

  /** Hands the owner every row, one at a time, once the queue is durable. */
  async adoptMediaOwner(
    owner: Pick<HistoryMediaOwner, 'adopt'>,
  ): Promise<void> {
    for await (const row of this.streamRows()) owner.adopt([row]);
  }

  /** Removes the newest row (design 4.3) and takes it back if the media effect or the observer fails. */
  removeTail(request: HistoryRemoveTailRequest): Promise<IContent | undefined> {
    return removeTailOnJournal(this, request);
  }

  /** Makes the owner hold the media of the current rows, one streamed pass. */
  reconcileMedia(owner: HistoryMediaOwner): Promise<void> {
    return reconcileMediaOnJournal(this, owner);
  }

  /** Appends the accepted rows of another history as one detached append. */
  mergeFrom(request: HistoryMergeRequest): Promise<void> {
    return mergeOnJournal(this, request);
  }

  /** Applies the decisions of a density optimizer as one detached transform. */
  optimizeDensity(request: HistoryDensityRequest): Promise<void> {
    return optimizeDensityOnJournal(this, request);
  }

  /** Writes `candidate` as the live rows at once; `rollback` restores the saved version (decision G3). */
  stageProfileReplacement(
    candidate: ProfileCandidateRows,
    request: HistoryProfileReplacementRequest,
  ): Promise<StagedProfileAdoption> {
    return stageProfileReplacementOnJournal(this, candidate, request);
  }

  /**
   * Names the version the queue reaches with everything accepted so far, so a
   * later {@link compensate} can put it back without a copy of any row.
   */
  captureCompensation(): JournalCompensationMark {
    this.assertUsable();
    return new JournalCompensationMark(
      this,
      this.queue.then(() => this.session.store.snapshot()),
    );
  }

  /** Lets go of the version a mark names; the owner of the mark calls it once, after the last compensation. */
  async releaseCompensation(mark: JournalCompensationMark): Promise<void> {
    await (await mark.saved).close();
  }

  /**
   * Undoes everything admitted since `mark` with `restore(version)`. When no
   * group was acked since, nothing is written. `held` is the failure the
   * caller received from its own groups, or undefined when it received none
   * from the store. Only that failure is cleared: a failure the queue holds
   * that the caller does not hold was never reported to anyone, so it stays
   * sticky and is thrown from here instead of being lost. If the restore
   * itself fails the store keeps that failure.
   */
  async compensate(
    mark: HistoryCompensationMark,
    held: unknown,
  ): Promise<void> {
    if (!(mark instanceof JournalCompensationMark) || mark.store !== this) {
      throw new Error('The compensation mark was not captured by this store');
    }
    const saved = await mark.saved;
    await this.queue;
    if (this.failure !== undefined) {
      if (this.failure.error !== held) throw this.failure.error;
      this.failure = undefined;
    }
    const unchanged =
      this.session.store.published?.commitSeq === saved.version?.commitSeq;
    if (unchanged) {
      this.tentativeRows = saved.rows;
      return;
    }
    await this.restoreTo(saved);
  }

  /** Runs a detached task against the durable rows and publishes its result (design 4.5). */
  publishDetached(
    task: DetachedHistoryTask,
    host: DetachedHistoryHost,
    modelName: string | undefined,
    options: DetachedHistoryOptions,
  ): Promise<void> {
    return publishDetachedOnJournal(this, task, host, modelName, options);
  }

  /** A checkpoint over the rows durable now (design 4.5): the callback reads them from the saved version. */
  withCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (checkpoint: HistoryCheckpointRows) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return withCheckpointOnJournal(this, host, enqueue, execute, signal);
  }

  /** A checkpoint whose `restore` is `restore(version)` of the version saved now. */
  withRollbackCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (restore: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return withRollbackCheckpointOnJournal(this, host, enqueue, execute);
  }

  /** Settles the queue, then closes the journal. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue;
    await this.startup;
    for (const dump of [...this.openDumps]) await dump.close();
    if (this.journal === undefined) return;
    await this.checkpointLifetime.closePrimary(
      this.journal,
      this.adopted !== undefined,
    );
  }

  /**
   * The first user row of an origin is the session preview of the recorders
   * that hold it (decision G7): the adopted file holds every row, a bound
   * recorder its own origin's and the unowned ones.
   */
  private offerPreview(content: IContent, origin: string | undefined): void {
    if (this.previews.has(origin)) return;
    const text = previewOfContent(content);
    if (text === undefined) return;
    this.previews.offer(origin, text);
    if (this.adopted !== undefined && this.topology.acceptsPreview(origin)) {
      this.adopted.recordFirstUserPreview(text);
      this.adoptedWrites.track(this.adopted.flush());
    }
    // Recorders bind after the journal is open, and then take the offered preview.
    this.journal?.mirrors.announcePreview(origin, text);
  }

  /** Runs `task` after everything queued, ahead of anything queued later; its failure goes to the caller and does not stop the queue. */
  private exclusive<T>(task: () => Promise<T>, detaching = false): Promise<T> {
    const turn = this.queue.then(() => {
      if (this.failure !== undefined && !detaching) throw this.failure.error;
      return task();
    });
    this.queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /**
   * Queues one operation: the tentative count moves now, the group is built
   * and committed when the operations before it are acked, and its ack must
   * show the count that was promised.
   */
  private enqueue(rowsAfter: number, build: EditBuilder): void {
    this.assertUsable();
    void this.enqueueTurn(rowsAfter, build);
  }

  private enqueueTurn(
    rowsAfter: number | undefined,
    build: EditBuilder,
  ): Promise<CommitAck | undefined> {
    if (rowsAfter !== undefined) this.tentativeRows = rowsAfter;
    this.publication.accepted();
    const turn = this.queue.then(() => this.runStep(rowsAfter, build));
    this.queue = turn.then(() => undefined);
    return turn;
  }

  /** The ack of a queued group; a group the queue skipped or failed throws the failure that stopped it. */
  private async requireAck(
    turn: Promise<CommitAck | undefined>,
  ): Promise<CommitAck> {
    const ack = await turn;
    if (ack === undefined) {
      throw this.failure?.error ?? new Error('The group was not committed');
    }
    return ack;
  }

  /** The builder of the single `replace` edit of `rows`, every row written under `origin`. */
  private replaceEdits(
    rows: Iterable<IContent> | AsyncIterable<IContent>,
    origin: string | undefined,
  ): EditBuilder {
    return async () => {
      const owner = await this.owners.resolve(origin);
      return [
        ...owner.edits,
        { kind: 'replace', rows: encodedRows(rows, owner.id) },
      ];
    };
  }

  /** Puts the version of `saved` back as the current one (design 4.5) and waits for its ack. */
  private async restoreTo(saved: VersionSnapshot): Promise<void> {
    const edit = this.session.store.restorationOf(saved);
    await this.requireAck(
      this.enqueueTurn(saved.rows, () => Promise.resolve([edit])),
    );
  }

  private async runStep(
    rowsAfter: number | undefined,
    build: EditBuilder,
  ): Promise<CommitAck | undefined> {
    if (this.failure !== undefined) return undefined;
    try {
      return await this.commitStep(rowsAfter, build);
    } catch (error) {
      this.failure = { error };
      this.owners.invalidate();
      return undefined;
    }
  }

  /** The snapshot the builder reads stays pinned until the group is acked: the edits may stream from it. */
  private async commitStep(
    rowsAfter: number | undefined,
    build: EditBuilder,
  ): Promise<CommitAck> {
    const snapshot = await this.session.store.snapshot();
    try {
      const edits = await build(snapshot);
      const prepared = await this.topology.prepare(edits);
      const group = await this.mirrors.commit(prepared);
      try {
        if (rowsAfter === undefined) {
          this.tentativeRows = group.after.rows;
        } else if (group.after.rows !== rowsAfter) {
          throw new Error(
            `The journal holds ${group.after.rows} rows after commit ${group.ack.commitSeq}, the history promised ${rowsAfter}`,
          );
        }
        this.ack = group.ack;
        return group.ack;
      } finally {
        await group.close();
      }
    } finally {
      await snapshot.close();
    }
  }

  /** The mutation FIFO keeps the queue empty around a whole operation; a count that differs means it did not. */
  private assertSettled(snapshot: VersionSnapshot, doing: string): void {
    if (snapshot.rows !== this.tentativeRows) {
      throw new Error(`History changed while it was being ${doing}`);
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('The journal history store is disposed');
    if (this.failure !== undefined) throw this.failure.error;
  }
}
