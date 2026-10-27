/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import type { MirrorCheckpoint } from '../../journal/mirrorCheckpoint.js';
import type {
  CommittedGroup,
  JournalStore,
} from '../../journal/journalStore.js';
import { MirrorFanout } from '../../journal/mirrorFanout.js';
import { JOURNAL_SPAN_WINDOW } from './journalSpanWindow.js';
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { JournalOwners } from './journalOwners.js';
import type { JournalSession } from './journalSession.js';
import { PendingRecorderWrites } from './pendingRecorderWrites.js';
import { recorderAcceptsRow } from './sessionPreviews.js';

/** What the mirrors need from the store's operation queue. */
export interface MirrorQueue {
  /** Runs `task` after everything queued, ahead of anything queued later. */
  exclusive<T>(task: () => Promise<T>, detaching?: boolean): Promise<T>;
  /** Throws when the store is disposed or failed. */
  assertUsable(): void;
}

/** A recorder bound as a mirror, with the origin whose rows it holds. */
export interface BoundRecorder {
  readonly recorder: JournalRecordingService;
  readonly session: JournalSession | undefined;
  readonly origin: string | undefined;
}

/**
 * The per-agent mirror files of one history and the origin bookkeeping that
 * goes with them (design 5.2 and 5.3). The primary journal keeps every row;
 * `commit` is the only way a group reaches it, so each acked group is also
 * delivered to the mirrors as a delta. It replaces `HistoryRecorderFanout`,
 * `HistoryFanoutFeed` and the mirror translation of the JSONL stack.
 */
export class JournalMirrors {
  async flushCommitted(): Promise<void> {
    await this.flush();
    for (const held of this.recorders.values()) {
      if (held.session !== undefined) await held.session.store.flushCommitted();
    }
  }

  private readonly fanout: MirrorFanout;
  private primaryOrigin: string | undefined;
  private readonly recorders = new Map<
    JournalRecordingService,
    {
      readonly session: JournalSession | undefined;
      readonly origin: string | undefined;
    }
  >();
  private readonly previewWrites = new PendingRecorderWrites();

  constructor(
    private readonly primary: JournalStore,
    private readonly owners: JournalOwners,
    private readonly queue: MirrorQueue,
    /** Shared by the mirrors of successive primaries, so a swap keeps the listeners. */
    private readonly retired: Set<() => void> = new Set(),
  ) {
    this.fanout = new MirrorFanout(primary, [JOURNAL_SPAN_WINDOW]);
  }

  async displayTarget(origin: string | undefined): Promise<JournalStore> {
    await this.materializeRecorders();
    for (const held of this.recorders.values()) {
      if (held.origin === origin && held.session !== undefined) {
        return held.session.store;
      }
    }
    return this.primary;
  }

  get size(): number {
    return this.fanout.mirrors;
  }

  checkpoint(): Promise<MirrorCheckpoint> {
    return this.fanout.checkpoint();
  }

  async commit(
    edits: readonly VersionEdit[],
    checkpoint?: MirrorCheckpoint,
  ): Promise<CommittedGroup> {
    await this.materializeRecorders();
    return this.fanout.commitDetailed(edits, checkpoint);
  }

  isOnlyRecorder(recorder: JournalRecordingService): boolean {
    return (
      this.onlyRecorders &&
      this.recorders.size === 1 &&
      this.recorders.has(recorder)
    );
  }

  async materializeRecorders(): Promise<void> {
    for (const [recorder, held] of this.recorders) {
      if (held.session !== undefined) continue;
      const session = await recorder.session();
      await this.seedAndBind(session, held.origin);
      this.recorders.set(recorder, { session, origin: held.origin });
    }
  }

  /**
   * Seeds and binds the mirror file of `origin` behind everything queued
   * (late attach, design 5.3).
   */
  attach(mirror: JournalSession, origin: string | undefined): Promise<void> {
    this.queue.assertUsable();
    return this.queue.exclusive(() => this.seedAndBind(mirror, origin));
  }

  /**
   * The origin gets its owner id first, in a state-only group, because the
   * seed filters by the id. It runs behind the queued groups so the seed sees
   * them.
   */
  private async seedAndBind(
    mirror: JournalSession,
    origin: string | undefined,
  ): Promise<void> {
    await this.fanout.attach(mirror.store, await this.ownerId(origin));
  }

  private async ownerId(origin: string | undefined): Promise<number> {
    const owner = await this.owners.resolve(origin);
    try {
      if (owner.edits.length > 0) await this.fanout.commit(owner.edits);
    } catch (error) {
      this.owners.invalidate();
      throw error;
    }
    return owner.id;
  }

  /** Unbinds a mirror once it has applied what was delivered; false when it was not bound. */
  detach(mirror: JournalSession): Promise<boolean> {
    return this.queue.exclusive(() => this.fanout.detach(mirror.store), true);
  }

  /**
   * Binds the file of a session recorder as the mirror of `origin`. The file
   * is brought in line with the history by the attach itself, so it can only
   * be appended to when it is empty: a recorder that already holds rows needs
   * `replace`. A recorder that is already bound is only reported attached.
   * Resume adopts a file instead (S08).
   */
  async attachRecorder(
    recorder: JournalRecordingService,
    replace: boolean,
    onAttached: (() => void) | undefined,
    origin: string | undefined,
  ): Promise<void> {
    this.queue.assertUsable();
    if (this.recorders.has(recorder)) {
      onAttached?.();
      return;
    }
    const first = this.recorders.size === 0;
    await this.queue.exclusive(async () => {
      const session = await this.bindRecorder(recorder, origin, replace);
      this.recorders.set(recorder, { session, origin });
    });
    if (first && origin !== undefined) this.primaryOrigin ??= origin;
    try {
      onAttached?.();
    } catch (error) {
      await this.detachRecorder(recorder);
      throw error;
    }
    await this.queue.exclusive(async () => {
      for (const [previous, binding] of this.recorders) {
        if (
          origin === undefined ||
          previous === recorder ||
          binding.origin !== origin
        )
          continue;
        if (binding.session !== undefined)
          await this.fanout.detach(binding.session.store);
        this.recorders.delete(previous);
      }
    });
  }

  /** Unbinds a recorder once its file has applied what was delivered; one that is not bound is ignored. */
  async detachRecorder(recorder: JournalRecordingService): Promise<void> {
    await this.queue.exclusive(() => this.unbindRecorder(recorder), true);
  }

  async unbindRecorder(recorder: JournalRecordingService): Promise<void> {
    const bound = this.recorders.get(recorder);
    if (bound === undefined) return;
    try {
      if (bound.session !== undefined)
        await this.fanout.detach(bound.session.store);
    } finally {
      this.recorders.delete(recorder);
    }
  }

  /** Whether every bound mirror is a recorder, which is what a swap of the primary can move. */
  get onlyRecorders(): boolean {
    let bound = 0;
    for (const held of this.recorders.values()) {
      if (held.session !== undefined) bound += 1;
    }
    return this.fanout.mirrors === bound;
  }

  /**
   * Unbinds every recorder, inside an exclusive turn of the queue. Each file
   * has applied what was delivered and nothing is written to it.
   */
  async unbindRecorders(): Promise<BoundRecorder[]> {
    const bound = [...this.recorders].map(([recorder, held]) => ({
      recorder,
      ...held,
    }));
    for (const { recorder, session } of bound) {
      if (session !== undefined) await this.fanout.detach(session.store);
      this.recorders.delete(recorder);
    }
    return bound;
  }

  /**
   * Binds recorders that were bound to another primary, inside an exclusive
   * turn: each file is brought in line with this primary by the attach, so a
   * file that held other rows is replaced.
   */
  async bindRecorders(bound: readonly BoundRecorder[]): Promise<void> {
    for (const { recorder, origin } of bound) {
      const session = await this.bindRecorder(recorder, origin, true);
      this.recorders.set(recorder, { session, origin });
    }
  }

  private async bindRecorder(
    recorder: JournalRecordingService,
    origin: string | undefined,
    replace: boolean,
  ): Promise<JournalSession | undefined> {
    if (
      recorder.getFilePath() === null &&
      (this.primary.published?.rows ?? 0) === 0
    ) {
      await this.ownerId(origin);
      return undefined;
    }
    const session = await recorder.session();
    if (!replace && (session.store.published?.rows ?? 0) > 0) {
      throw new Error(
        `The recorder already holds rows (${session.path}); attaching it must replace them`,
      );
    }
    await this.seedAndBind(session, origin);
    return session;
  }

  /** The file of the recorder bound first, which holds the rows of the primary origin; null when none is bound. */
  firstRecorderPath(): string | null {
    for (const { session } of this.recorders.values()) {
      if (session !== undefined) return session.path;
    }
    return null;
  }

  isRecorder(recorder: JournalRecordingService): boolean {
    return this.recorders.has(recorder);
  }

  /**
   * Offers the first user row of `rowOrigin` as the session preview of every
   * bound recorder that holds that row (decision G7); a recorder that has a
   * preview ignores it. The writes are part of {@link flush}.
   */
  announcePreview(rowOrigin: string | undefined, text: string): void {
    for (const [recorder, bound] of this.recorders) {
      if (!recorderAcceptsRow(bound.origin, rowOrigin)) continue;
      recorder.recordFirstUserPreview(text);
      this.previewWrites.track(recorder.flush());
    }
  }

  has(mirror: JournalSession): boolean {
    return this.fanout.has(mirror.store);
  }

  /** Waits for every mirror to apply what was delivered and for the preview writes of the recorders; throws every failure. */
  async flush(unreportedOnly = false): Promise<void> {
    await Promise.all([
      this.fanout.flush(unreportedOnly),
      this.previewWrites.settle(),
    ]);
  }

  /** Brings every mirror's recorded primary version up to date, then tells the retirement listeners. */
  async retire(): Promise<void> {
    try {
      await this.fanout.syncIdentities();
    } finally {
      for (const listener of this.retired) listener();
    }
  }

  /** Tells the retirement listeners that the session of this primary is replaced, once. */
  fireRetired(listeners: ReadonlyArray<() => void>): void {
    for (const listener of listeners) {
      if (this.retired.delete(listener)) listener();
    }
  }

  /** The listeners of this primary; a successor primary shares them. */
  get retirementListeners(): Set<() => void> {
    return this.retired;
  }

  onRetired(listener: () => void): () => void {
    this.retired.add(listener);
    return () => this.retired.delete(listener);
  }

  primaryOriginId(): string | undefined {
    return this.primaryOrigin;
  }

  /** Makes `origin` the primary origin of a successor primary without the check of {@link adoptedOrigin}. */
  inheritPrimaryOrigin(origin: string | undefined): void {
    this.primaryOrigin = origin;
  }

  /** A resumed recorder was adopted for `origin`; with mirrors bound it must name one. */
  adoptedOrigin(origin: string | undefined): void {
    if (this.size > 0 && origin === undefined) {
      throw new Error(
        'A resumed recorder in a fan-out history must name its origin',
      );
    }
    this.primaryOrigin = origin;
    this.owners.adoptOrigin(origin);
  }
}
