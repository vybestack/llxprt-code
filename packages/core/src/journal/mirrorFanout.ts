/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from './groupEdits.js';
import { deltaOf, type GroupDelta } from './groupDelta.js';
import type { CommitAck } from './groupWriter.js';
import type { CommittedGroup, JournalStore } from './journalStore.js';
import {
  mirrorEdits,
  resyncEdits,
  type MirrorTarget,
  type PinnedVersion,
} from './mirrorApply.js';
import {
  MIRROR_PRIMARY_KEY,
  identityEdit,
  identityOf,
  parseIdentity,
  sameIdentity,
  type PrimaryIdentity,
} from './mirrorIdentity.js';
import { OwnerDictionary } from './ownerDictionary.js';

/** One mirror file bound to the fan-out: whose rows it holds and how far it has been brought. */
interface MirrorLink extends MirrorTarget {
  /** Applies deltas one after another; it never rejects, a failure is kept in `failure`. */
  queue: Promise<void>;
  /** The primary version the mirror's newest group recorded. */
  recorded: PrimaryIdentity;
  /** Once a mirror has failed it applies nothing more: its file has a gap that only a resync closes. */
  failure: { readonly error: unknown } | undefined;
}

/** More than one failure is reported together, as `HistoryRecorderFanout.flush` does. */
function rethrowAll(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

async function recordedIdentity(
  store: JournalStore,
): Promise<PrimaryIdentity | undefined> {
  const stored = await store.getState(MIRROR_PRIMARY_KEY);
  return stored === undefined ? undefined : parseIdentity(stored);
}

/**
 * The primary journal and the mirror files of its agents (design 5.2 and
 * 5.3). Every mutation of the primary goes through `commit`, one group at a
 * time. After a group is acked, its delta is queued for each mirror, and each
 * mirror applies the deltas in order as groups of its own file. `flush` waits
 * for every mirror and reports every failure, so one failing mirror hides
 * nothing about another.
 */
export class MirrorFanout {
  private readonly links: MirrorLink[] = [];
  /** The mutation FIFO: commits and attaches run one at a time in the order they arrive. */
  private fifo: Promise<void> = Promise.resolve();

  constructor(private readonly primary: JournalStore) {}

  get mirrors(): number {
    return this.links.length;
  }

  /** Commits to the primary, queues the group's delta for every mirror, and returns when the primary has acked. */
  async commit(edits: readonly VersionEdit[]): Promise<CommitAck> {
    return (await this.commitDetailed(edits)).ack;
  }

  /** Like {@link commit}, and returns the group with the versions before and after it. */
  commitDetailed(edits: readonly VersionEdit[]): Promise<CommittedGroup> {
    return this.serial(async () => {
      // Taken before the commit: a mirror reads the group's records by offset
      // after the ack, and a compaction in between would move them (design 4.11).
      const release = await this.primary.pin();
      let handedOver = false;
      try {
        const group = await this.primary.commitDetailed(edits);
        if (this.links.length === 0) return group;
        const delta = deltaOf(group, edits);
        const applied = this.links.map((link) => this.deliver(link, delta));
        // The pin lasts until every mirror has read the group's records.
        handedOver = true;
        void Promise.all(applied).then(release);
        return group;
      } finally {
        if (!handedOver) release();
      }
    });
  }

  /**
   * Unbinds the mirror file `store` once everything queued for it is applied.
   * Returns false when it was not bound. The file is left as it is.
   */
  detach(store: JournalStore): Promise<boolean> {
    return this.serial(async () => {
      const at = this.links.findIndex((link) => link.store === store);
      if (at < 0) return false;
      await this.links[at].queue;
      this.links.splice(at, 1);
      return true;
    });
  }

  /** Whether `store` is bound as a mirror. */
  has(store: JournalStore): boolean {
    return this.links.some((link) => link.store === store);
  }

  /**
   * Binds the mirror file `store` for the agent `owner` (design 5.3). A mirror
   * whose recorded primary version equals the primary's published one is in
   * sync and is bound with nothing written. A new mirror, and one that differs
   * in either direction, is brought to the accepted rows of the primary by one
   * group that replaces its history. Groups that are committed after the
   * attach started are delivered after the bind, because they queue behind it.
   */
  attach(store: JournalStore, owner: number): Promise<void> {
    return this.serial(async () => {
      const release = await this.primary.pin();
      try {
        await this.bind(store, owner);
      } finally {
        release();
      }
    });
  }

  private async bind(store: JournalStore, owner: number): Promise<void> {
    const pin = this.pin();
    const current = identityOf(pin?.version);
    const recorded = await recordedIdentity(store);
    const link: MirrorLink = {
      store,
      owner,
      queue: Promise.resolve(),
      recorded: recorded ?? current,
      failure: undefined,
    };
    const empty = pin === undefined && store.published === undefined;
    const inSync =
      recorded === undefined ? empty : sameIdentity(recorded, current);
    if (!inSync) await this.resynchronize(link, pin, current);
    this.links.push(link);
  }

  /** Waits for every mirror to apply what was queued, then throws every failure. */
  async flush(): Promise<void> {
    await this.fifo;
    await Promise.all(this.links.map((link) => link.queue));
    rethrowAll(
      this.links.flatMap((link) =>
        link.failure === undefined ? [] : [link.failure.error],
      ),
      'Mirror fan-out flush failed',
    );
  }

  /**
   * Flushes, then records the primary's published version in every mirror
   * that is behind it only because it was sent nothing (a group that none of
   * its rows concern writes nothing to it). One state group per such mirror,
   * so a clean shutdown leaves every mirror in sync and the next attach
   * writes nothing.
   */
  async syncIdentities(): Promise<void> {
    await this.flush();
    const current = identityOf(this.primary.published);
    const results = await Promise.allSettled(
      this.links
        .filter((link) => !sameIdentity(link.recorded, current))
        .map(async (link) => {
          await link.store.commit([identityEdit(current)]);
          link.recorded = current;
        }),
    );
    rethrowAll(
      results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : [])),
      'Mirror identity update failed',
    );
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.fifo.then(work);
    this.fifo = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /** Applies `delta` to the mirror; settles when it is applied or has failed (the failure is kept on the link). */
  private deliver(link: MirrorLink, delta: GroupDelta): Promise<void> {
    link.queue = link.queue.then(async () => {
      if (link.failure !== undefined) return;
      try {
        const edits = await mirrorEdits(delta, link);
        if (edits.length === 0) return;
        await link.store.commit([...edits, identityEdit(delta.identity)]);
        link.recorded = delta.identity;
      } catch (error) {
        link.failure = { error };
      }
    });
    return link.queue;
  }

  /** The published primary version with reads that reach it, or undefined before its first group. */
  private pin(): PinnedVersion | undefined {
    const version = this.primary.published;
    if (version === undefined) return undefined;
    return { version, access: this.primary.recordAccess() };
  }

  /** One group that replaces the mirror's history with the accepted rows of the primary, the owner dictionary and the primary's identity. */
  private async resynchronize(
    link: MirrorLink,
    pin: PinnedVersion | undefined,
    current: PrimaryIdentity,
  ): Promise<void> {
    const dictionary = await OwnerDictionary.load(this.primary);
    await link.store.commit([
      ...resyncEdits(link, pin),
      ...dictionary.stateEdits(),
      identityEdit(current),
    ]);
    link.recorded = current;
  }
}
