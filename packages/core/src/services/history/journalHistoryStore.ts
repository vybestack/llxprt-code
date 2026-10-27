/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { journalDisplayCommands } from './journal-display-commands.js';
import {
  responseArrivalOpener,
  assertArrivalRowDelta,
  assertHistorySettled,
} from './journal-arrival-adapter.js';
import {
  commitAdmittedAppend,
  decodeTokenDraft,
  releaseUnclaimedTokenDraft,
  type TokenDraft,
  StartupAdmissions,
  type AppendAdmissionRun,
} from './journal-append-admission.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { MirrorCheckpoint } from '../../journal/mirrorCheckpoint.js';
import type { TokenRowSource } from './history-token-tickets.js';
import { JournalTokenRows } from './journal-token-rows.js';
import { JournalHistoryStoreMutations } from './journal-history-store-mutations.js';
import { JournalRowMutations } from './journal-row-mutations.js';
import { prepareJournalProviderRequest } from './native-purge-provider-request.js';
import * as nativeFormat from './native-provider-format.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import type {
  HistoryStorePort,
  HistoryJournalOp,
  HistoryMutationMark,
  HistoryPublicationScope,
  HistoryResumeRequest,
} from './historyStorePort.js';
import { journalCompressionInput } from './journalDumpSnapshot.js';
import {
  adoptOnto,
  type AdoptionHost,
  type JournalAdoption,
} from './journalAdoption.js';
import { JournalMirrors } from './journalMirrors.js';
import { RecordingPrimary } from './recording-primary.js';
import { JournalOwners } from './journalOwners.js';
import { JournalCheckpointLifetime } from './journalCheckpoints.js';
import {
  captureSettledJournalSnapshot,
  openJournalToolRanking,
} from './journal-tool-ranking.js';
import type { JournalSession } from './journalSession.js';
import {
  replacementEditBuilder,
  JournalPublication,
  type EditBuilder,
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

export type {
  JournalHistoryStoreOptions,
  JournalRepair,
  JournalSessionOpener,
} from './journal-history-store-types.js';
import type * as StoreTypes from './journal-history-store-types.js';

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
export class JournalHistoryStore
  extends JournalHistoryStoreMutations
  implements HistoryStorePort
{
  protected get operationStore(): JournalHistoryStore {
    return this;
  }

  readonly openResponseArrival = responseArrivalOpener({
    store: () => this.session.store,
    owners: () => this.owners,
    exclusive: (run) => this.exclusive(run),
    commit: (build) => {
      this.tokenDraft = undefined;
      return this.commitStep(undefined, build, undefined, true);
    },
  });

  protected readonly display = journalDisplayCommands({
    store: () => this.session.store,
    target: async (origin) =>
      this.mirrors.size === 0 ||
      (this.adopted !== undefined && this.mirrors.primaryOriginId() === origin)
        ? this.session.store
        : this.mirrors.displayTarget(origin),
    owners: () => this.owners,
    exclusive: (run) => this.exclusive(run),
    commit: (build) => {
      this.publication.accepted();
      this.tokenDraft = undefined;
      return this.commitStep(undefined, build, undefined, true);
    },
  });

  prepareCurated = prepareJournalProviderRequest(
    this,
    () => this.session.store.mediaPins.mediaStore,
  );

  prepareTokenUsageFacts = (): Promise<void> =>
    this.exclusive(async () => {
      if (this.session.store.enableNeutralRowFacts())
        await this.commitStep(this.tentativeRows, async () => [
          { kind: 'append', rows: [] },
        ]);
    });

  pinnedRequestResources = () =>
    nativeFormat.nativeRequestResources(this.session.store);

  readonly nativePreparation = nativeFormat.nativeRequestPreparations({
    exclusive: (run) => this.exclusive(run),
    current: () => this.session.store.published,
    commit: (edits) => this.commitStep(this.tentativeRows, edits),
    snapshot: () => this.session.store.snapshot(),
    preparePinnedFormat: (snapshot, registration) =>
      this.session.store.prepareSnapshotFormat(snapshot, registration),
    preparePinnedKimi: (snapshot) =>
      this.session.store.prepareSnapshotKimi(snapshot),
  });

  protected tentativeRows = 0;
  private tokenDraftSequence = 0;
  private tokenDraft: TokenDraft | undefined;
  private appendingTokenRow = false;
  private readonly tokenRows = new JournalTokenRows({
    snapshot: () => this.exclusive(() => this.session.store.snapshot()),
    takeDraft: (sequence) => this.takeTokenDraft(sequence),
    releaseDraft: (sequence) => {
      if (this.tokenDraft?.sequence === sequence) this.tokenDraft = undefined;
    },
  });
  private appendRun: AppendAdmissionRun | undefined;
  private queuedAppendRuns = 0;
  private readonly startupAdmissions = new StartupAdmissions({
    rows: () => this.tentativeRows,
    enqueue: (rowsAfter, build) => this.enqueue(rowsAfter, build),
    owners: () => this.owners,
  });

  private appendAdmitted(draft: RowDraft, origin: string | undefined): void {
    if (this.journal === undefined) {
      this.startupAdmissions.append(draft, origin);
      return;
    }
    const store = this.topology.admissionStore(origin);
    const current = this.appendRun;
    const extending =
      current !== undefined &&
      current.origin === origin &&
      current.store === store;
    if (!extending && this.queuedAppendRuns >= 32)
      throw new Error('Journal append range admission budget exceeded');
    const admitted = store.admissions.admit(draft);
    if (extending) {
      current.end = admitted.end;
      current.count++;
      current.rowsAfter = ++this.tentativeRows;
      current.tokenSequence = this.tokenDraftSequence + 1;
      this.publication.accepted();
      return;
    }
    const run = {
      ...admitted,
      store,
      releaseReader: store.admissions.retainReader(),
      count: 1,
      rowsAfter: this.tentativeRows + 1,
      tokenSequence: this.tokenDraftSequence + 1,
      origin,
    };
    this.appendRun = run;
    this.queuedAppendRuns++;
    this.tentativeRows = run.rowsAfter;
    this.publication.accepted();
    const turn = this.queue.then(() => this.runAdmittedAppend(run));
    this.queue = turn.then(() => undefined);
  }

  private async runAdmittedAppend(
    run: NonNullable<JournalHistoryStore['appendRun']>,
  ): Promise<void> {
    if (this.appendRun === run) this.appendRun = undefined;
    const store = run.store;
    try {
      if (this.failure !== undefined) return;
      await commitAdmittedAppend(run, {
        owners: () => this.owners,
        commit: (rowsAfter, build) => this.commitStep(rowsAfter, build),
      });
    } catch (error) {
      this.failure = { error };
      this.owners.invalidate();
    } finally {
      this.queuedAppendRuns--;
      this.tokenDraft = releaseUnclaimedTokenDraft(
        this.tokenDraft,
        run.tokenSequence,
      );
      store.admissions.release(run.count);
      await run.releaseReader();
    }
  }

  protected queue: Promise<void>;
  protected failure:
    | { readonly error: unknown; reported?: boolean }
    | undefined;
  private restoreFailed = false;
  private ack: CommitAck | undefined;
  private disposed = false;
  private disposal: Promise<void> | undefined;
  readonly checkpointLifetime = new JournalCheckpointLifetime();
  protected readonly publication = new JournalPublication();
  protected journal: StoreTypes.OpenJournal | undefined;
  /** Settles when the journal is open; rejects with the reason it could not be. */
  private readonly opened: Promise<void>;
  /** Settles when the journal is open and the recorder given at construction is bound; never rejects. */
  private readonly startup: Promise<void>;
  /** Shared by the mirrors of successive primaries, so a swap keeps the listeners. */
  private readonly retirement = new Set<() => void>();
  /** What a publication needs to queue its own groups (see journalOps.ts); every queued group is checked for a usable store. */
  readonly writes: JournalWriteHost = {
    rows: () => this.tentativeRows,
    append: (draft, origin) => this.appendAdmitted(draft, origin),
    owners: () => this.owners,
    enqueue: (rowsAfter, build) => this.enqueue(rowsAfter, build),
    offerPreview: (content, origin) => this.offerPreview(content, origin),
  };
  protected readonly rowMutations = new JournalRowMutations({
    writes: this.writes,
    assertUsable: () => this.assertUsable(),
    rows: () => this.tentativeRows,
    owners: () => this.owners,
    store: () => this.session.store,
    enqueue: (rowsAfter, build) => this.enqueue(rowsAfter, build),
    withSnapshot: (read) => this.withDurableSnapshot(read),
    assertSettled: (snapshot, doing) => this.assertSettled(snapshot, doing),
    restoreTo: (saved) => this.restoreTo(saved),
    waitForDurable: () => this.waitForDurable(),
    lastAck: () => this.ack,
    captureCompensation: () => this.captureCompensation(),
    compensate: (mark, held) => this.compensate(mark, held),
    releaseCompensation: (mark) => this.releaseCompensation(mark),
  });
  private adopted: JournalRecordingService | undefined;
  protected boundary: bigint | undefined;
  private previews = new SessionPreviews();
  private readonly adoptedWrites = new PendingRecorderWrites();
  private readonly topology = new RecordingPrimary(this.adoptionHost());

  constructor(
    source: JournalSession | StoreTypes.JournalSessionOpener,
    protected readonly options: StoreTypes.JournalHistoryStoreOptions = {},
  ) {
    super();
    const session = typeof source === 'function' ? source() : source;
    if (session instanceof Promise) {
      this.opened = session.then((opened) => this.install(opened));
      this.queue = this.opened.catch((error: unknown) => {
        this.failure = { error };
      });
    } else {
      this.install(session);
      this.tentativeRows = session.store.published?.rows ?? 0;
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
    return this.disposed || recording === undefined
      ? Promise.resolve()
      : this.attachJournal(recording);
  }

  /** The open journal; before it is open, or when it could not be, the reason. */
  protected requireOpen(): StoreTypes.OpenJournal {
    if (this.journal === undefined) {
      throw (
        this.failure?.error ??
        new Error('The journal history store is not open yet')
      );
    }
    return this.journal;
  }

  protected get session(): JournalSession {
    return this.requireOpen().session;
  }

  protected get owners(): JournalOwners {
    return this.requireOpen().owners;
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
      retirePrimary: (session) => this.topology.retirePrimary(session),
      mirrorsOf: (session, owners, listeners) =>
        this.mirrorsOf(session, owners, listeners),
    };
  }

  /** The ack of the last group that became durable. */
  get lastAck(): CommitAck | undefined {
    return this.ack;
  }

  /** A journal clear is asynchronous: the service holds its mutation queue until it settles (D-W7-5). */
  readonly clearIsAsynchronous = true;

  /** Rows once everything queued is applied; equals the published count when the queue is empty. */
  getLength = (): number => this.tentativeRows;

  readonly compressionRowCount = this.getLength;

  captureTokenRow(start?: number): TokenRowSource {
    this.assertUsable();
    const draft = this.tokenDraft;
    if (draft !== undefined) draft.captured = true;
    const tail = this.tentativeRows - 1;
    return this.tokenRows.capture(tail, draft?.sequence, start);
  }

  private takeTokenDraft(sequence: number | undefined): IContent | undefined {
    const available = this.tokenDraft;
    if (available === undefined || available.sequence !== sequence) return;
    this.tokenDraft = undefined;
    return decodeTokenDraft(available.draft);
  }

  apply(op: HistoryJournalOp): void {
    this.assertUsable();
    this.tokenDraft = undefined;
    this.appendingTokenRow = op.kind === 'content';
    try {
      const draft = applyOperation(this.writes, op);
      if (draft !== undefined) {
        this.tokenDraft = {
          sequence: ++this.tokenDraftSequence,
          draft,
          captured: false,
        };
      }
    } finally {
      this.appendingTokenRow = false;
    }
  }

  /**
   * The version a detached transform reads: the queue is durable, the token
   * updates the caller still owes are settled, and nothing was queued while
   * they ran. The snapshot holds a pin: the caller closes it.
   */
  settledSnapshot = captureSettledJournalSnapshot(
    () => this.waitForDurable(),
    () => this.session.store.snapshot(),
    (snapshot) => this.assertSettled(snapshot, 'captured'),
  );

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
      this.exclusive(async () => {
        if (!this.disposed && this.adopted === journalRecorder)
          await this.topology.detach(this.adoptedWrites, this.failure);
        await this.mirrors.unbindRecorder(journalRecorder);
      }, true),
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
    await this.session.store.idle();
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

  openCompressionInput = journalCompressionInput;

  openToolResponseRanking = openJournalToolRanking({
    wait: () => this.waitForDurable(),
    exclusive: (action) => this.exclusive(action),
    commit: async (edits) =>
      this.mirrors.commit(await this.topology.prepare(edits)),
    snapshot: () => this.session.store.snapshot(),
  });

  openDensityFiles = this.openToolResponseRanking.files;

  /** Settles the queue, then closes the journal. */
  dispose(beforeClose?: () => Promise<void>): Promise<void> {
    return (this.disposal ??= this.disposeInternal(beforeClose));
  }

  private async disposeInternal(
    beforeClose?: () => Promise<void>,
  ): Promise<void> {
    this.disposed = true;
    this.tokenDraft = undefined;
    await this.queue;
    await this.startup;
    const failures: unknown[] = [];
    if (
      this.failure !== undefined &&
      (this.restoreFailed || this.failure.reported !== true)
    )
      failures.push(this.failure.error);
    for (const close of [
      async () => beforeClose?.(),
      ...[...this.openDumps].map((dump) => () => dump.close()),
      () => this.publication.close(),
      () => this.topology.close(),
      async () => {
        if (this.journal !== undefined)
          await this.checkpointLifetime.closePrimary(
            this.journal,
            this.adopted !== undefined,
          );
      },
    ]) {
      try {
        await close();
      } catch (error) {
        if (!failures.includes(error)) failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Journal history store disposal failed',
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
  protected exclusive<T>(
    task: () => Promise<T>,
    detaching = false,
  ): Promise<T> {
    this.appendRun = undefined;
    this.tokenRows.seal();
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
  protected enqueue(rowsAfter: number, build: EditBuilder): void {
    this.assertUsable();
    void this.enqueueTurn(rowsAfter, build);
  }

  protected enqueueTurn(
    rowsAfter: number | undefined,
    build: EditBuilder,
    mirrors?: MirrorCheckpoint,
  ): Promise<CommitAck | undefined> {
    if (!this.appendingTokenRow) {
      this.appendRun = undefined;
      this.tokenRows.seal();
    }
    if (rowsAfter !== undefined) this.tentativeRows = rowsAfter;
    this.publication.accepted();
    const turn = this.queue.then(() => this.runStep(rowsAfter, build, mirrors));
    this.queue = turn.then(() => undefined);
    return turn;
  }

  /** The ack of a queued group; a group the queue skipped or failed throws the failure that stopped it. */
  protected async requireAck(
    turn: Promise<CommitAck | undefined>,
  ): Promise<CommitAck> {
    const ack = await turn;
    if (ack === undefined) {
      throw this.failure?.error ?? new Error('The group was not committed');
    }
    return ack;
  }

  /** The builder of the single `replace` edit of `rows`, every row written under `origin`. */
  protected readonly replaceEdits = replacementEditBuilder(() => this.owners);

  /** Puts the version of `saved` back as the current one (design 4.5) and waits for its ack. */
  protected async restoreTo(
    saved: VersionSnapshot,
    mirrors?: MirrorCheckpoint,
  ): Promise<void> {
    const edit = this.session.store.restorationOf(saved);
    try {
      await this.requireAck(
        this.enqueueTurn(saved.rows, () => Promise.resolve([edit]), mirrors),
      );
    } catch (error) {
      this.restoreFailed = true;
      throw error;
    }
  }

  private async runStep(
    rowsAfter: number | undefined,
    build: EditBuilder,
    mirrors?: MirrorCheckpoint,
  ): Promise<CommitAck | undefined> {
    if (this.failure !== undefined) return undefined;
    try {
      return await this.commitStep(rowsAfter, build, mirrors);
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
    mirrors?: MirrorCheckpoint,
    arrival = false,
  ): Promise<CommitAck> {
    const snapshot = await this.session.store.snapshot();
    try {
      const edits = await build(snapshot);
      const owners = this.owners;
      const prepared = await this.topology.prepare(edits);
      const group = await this.mirrors.commit(prepared, mirrors);
      if (owners !== this.owners) this.owners.invalidate();
      try {
        if (arrival) {
          this.acceptArrivalRows(group.after.rows - snapshot.rows);
        } else if (rowsAfter === undefined) {
          this.tentativeRows = group.after.rows;
        } else if (group.after.rows !== rowsAfter) {
          throw new Error(
            `The journal holds ${group.after.rows} rows after commit ${group.ack.commitSeq}, the history promised ${rowsAfter}`,
          );
        }
        if (group.unchanged !== true) this.ack = group.ack;
        return group.ack;
      } finally {
        await group.close();
      }
    } finally {
      await snapshot.close();
    }
  }

  private acceptArrivalRows(added: number): void {
    assertArrivalRowDelta(added);
    if (added > 0) this.publication.accepted();
    this.tentativeRows += added;
  }

  /** The mutation FIFO keeps the queue empty around a whole operation; a count that differs means it did not. */
  private assertSettled(snapshot: VersionSnapshot, doing: string): void {
    assertHistorySettled(snapshot.rows, this.tentativeRows, doing);
  }

  protected assertUsable(): void {
    if (this.disposed) throw new Error('The journal history store is disposed');
    if (this.failure !== undefined) throw this.failure.error;
  }
}
