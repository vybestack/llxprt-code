/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import type {
  CommittedGroup,
  JournalStore,
} from '../../journal/journalStore.js';
import { MirrorFanout } from '../../journal/mirrorFanout.js';
import type { JournalOwners } from './journalOwners.js';
import type { JournalSession } from './journalSession.js';

/** What the mirrors need from the store's operation queue. */
export interface MirrorQueue {
  /** Runs `task` after everything queued, ahead of anything queued later. */
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  /** Throws when the store is disposed or failed. */
  assertUsable(): void;
}

/**
 * The per-agent mirror files of one history and the origin bookkeeping that
 * goes with them (design 5.2 and 5.3). The primary journal keeps every row;
 * `commit` is the only way a group reaches it, so each acked group is also
 * delivered to the mirrors as a delta. It replaces `HistoryRecorderFanout`,
 * `HistoryFanoutFeed` and the mirror translation of the JSONL stack.
 */
export class JournalMirrors {
  private readonly fanout: MirrorFanout;
  private primaryOrigin: string | undefined;
  private readonly retired = new Set<() => void>();

  constructor(
    primary: JournalStore,
    private readonly owners: JournalOwners,
    private readonly queue: MirrorQueue,
  ) {
    this.fanout = new MirrorFanout(primary);
  }

  get size(): number {
    return this.fanout.mirrors;
  }

  commit(edits: readonly VersionEdit[]): Promise<CommittedGroup> {
    return this.fanout.commitDetailed(edits);
  }

  /**
   * Seeds and binds the mirror file of `origin` behind everything queued
   * (late attach, design 5.3).
   */
  attach(mirror: JournalSession, origin: string): Promise<void> {
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
    origin: string,
  ): Promise<void> {
    const owner = await this.owners.resolve(origin);
    try {
      if (owner.edits.length > 0) await this.fanout.commit(owner.edits);
    } catch (error) {
      this.owners.invalidate();
      throw error;
    }
    await this.fanout.attach(mirror.store, owner.id);
  }

  /** Unbinds a mirror once it has applied what was delivered; false when it was not bound. */
  detach(mirror: JournalSession): Promise<boolean> {
    return this.queue.exclusive(() => this.fanout.detach(mirror.store));
  }

  has(mirror: JournalSession): boolean {
    return this.fanout.has(mirror.store);
  }

  /** Waits for every mirror to apply what was delivered; throws every failure. */
  flush(): Promise<void> {
    return this.fanout.flush();
  }

  /** Brings every mirror's recorded primary version up to date, then tells the retirement listeners. */
  async retire(): Promise<void> {
    try {
      await this.fanout.syncIdentities();
    } finally {
      for (const listener of this.retired) listener();
    }
  }

  onRetired(listener: () => void): () => void {
    this.retired.add(listener);
    return () => this.retired.delete(listener);
  }

  primaryOriginId(): string | undefined {
    return this.primaryOrigin;
  }

  /** A resumed recorder was adopted for `origin`; with mirrors bound it must name one. */
  adoptedOrigin(origin: string | undefined): void {
    if (this.size > 0 && origin === undefined) {
      throw new Error(
        'A resumed recorder in a fan-out history must name its origin',
      );
    }
    this.primaryOrigin = origin;
  }
}
