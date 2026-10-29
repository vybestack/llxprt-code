/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { ResumePoint } from '../../recording/journalResume.js';
import type { BoundRecorder, JournalMirrors } from './journalMirrors.js';
import { JournalOwners } from './journalOwners.js';
import type { JournalSession } from './journalSession.js';
import { SessionPreviews } from './sessionPreviews.js';

/** A swap of the primary journal that can still be taken back; see {@link adoptOnto}. */
export interface JournalAdoption {
  /** Puts the prior store back. The adopted file is the recorder's and stays open. */
  rollback(): Promise<void>;
  /** Closes the prior store; the adoption can no longer be rolled back. */
  commit(): Promise<void>;
}

/** Everything that belongs to one primary journal and is swapped with it. */
export interface PrimaryState {
  readonly session: JournalSession;
  readonly owners: JournalOwners;
  readonly mirrors: JournalMirrors;
  /** Rows once everything queued is applied. */
  readonly rows: number;
  /** The recorder whose file is the primary, when a resume adopted one. */
  readonly adopted: JournalRecordingService | undefined;
  readonly previews: SessionPreviews;
  /** Rows with a label below this were written by an earlier process (D-S08-3). */
  readonly resumeBoundary: bigint | undefined;
}

/** What the adoption needs from the store; it runs inside one exclusive turn of the store's queue. */
export interface AdoptionHost {
  state(): PrimaryState;
  install(state: PrimaryState): void;
  /** Resolves once every operation queued so far has settled. */
  drained(): Promise<void>;
  retirePrimary(session: JournalSession): Promise<void>;
  mirrorsOf(
    session: JournalSession,
    owners: JournalOwners,
    listeners: Set<() => void>,
  ): JournalMirrors;
}
function restorePrimary(
  host: AdoptionHost,
  previous: PrimaryState,
  mirrors: JournalMirrors,
  moved: readonly BoundRecorder[],
): () => Promise<void> {
  return async () => {
    await mirrors.unbindRecorders();
    host.install(previous);
    await previous.mirrors.bindRecorders(moved);
  };
}

function assertAtPoint(next: JournalSession, point: ResumePoint): void {
  const published = next.store.published;
  if (
    (published?.commitSeq ?? 0) !== point.commitSeq ||
    (published?.rows ?? 0) !== point.rows
  ) {
    throw new Error(
      `The journal ${next.path} is at commit ${published?.commitSeq ?? 0} with ${published?.rows ?? 0} rows, the resume read commit ${point.commitSeq} with ${point.rows} rows`,
    );
  }
}

/**
 * Resume onto a recorder (decision G5, D-W4-1). The file the recorder opened
 * becomes the primary journal, inside one turn of the queue, so no group is in
 * flight on either file. The point must be the version the recorder is at: a
 * file that moved since the resume was read is refused. Nothing is opened
 * here, so a failure before the swap leaves the prior store in place and
 * nothing to close.
 *
 * Recorders bound to the replaced primary are moved with it. Those that hold
 * the replaced session (their origin is the primary origin; for the CLI that
 * is the live recorder) are unbound and their files are left as they are;
 * their retirement listeners fire at `commit`. Recorders of other origins stay
 * mirrors and are brought in line with the resumed rows. `rollback` puts the
 * prior store and every recorder back; `commit` closes the prior store.
 */
export async function adoptOnto(
  host: AdoptionHost,
  recorder: JournalRecordingService,
  point: ResumePoint,
): Promise<JournalAdoption> {
  const previous = host.state();
  if (!previous.mirrors.onlyRecorders) {
    throw new Error(
      'A history with mirrors that are not recorders cannot adopt a resumed journal',
    );
  }
  const next = await recorder.session();
  assertAtPoint(next, point);
  const retired = [...previous.mirrors.retirementListeners];
  const moved = await previous.mirrors.unbindRecorders();
  const primaryOrigin = previous.mirrors.primaryOriginId();
  const replaced = moved.filter(({ origin }) => origin === primaryOrigin);
  const owners = new JournalOwners(next.store);
  const mirrors = host.mirrorsOf(
    next,
    owners,
    previous.mirrors.retirementListeners,
  );
  mirrors.inheritPrimaryOrigin(primaryOrigin);
  const restore = restorePrimary(host, previous, mirrors, moved);
  host.install({
    session: next,
    owners,
    mirrors,
    rows: next.store.published?.rows ?? 0,
    adopted: recorder,
    previews: new SessionPreviews(),
    resumeBoundary: point.nextLabel,
  });
  try {
    await mirrors.bindRecorders(
      moved.filter((bound) => !replaced.includes(bound)),
    );
  } catch (error) {
    await restore();
    throw error;
  }
  return settledOnce(previous, replaced, host, restore, retired);
}
export async function adoptAttachedRecorder(
  host: AdoptionHost,
  recorder: JournalRecordingService,
): Promise<JournalAdoption> {
  const previous = host.state();
  const next = await recorder.session();
  const moved = await previous.mirrors.unbindRecorders();
  const owners = new JournalOwners(next.store);
  const mirrors = host.mirrorsOf(
    next,
    owners,
    previous.mirrors.retirementListeners,
  );
  mirrors.inheritPrimaryOrigin(previous.mirrors.primaryOriginId());
  const restore = restorePrimary(host, previous, mirrors, moved);
  host.install({
    ...previous,
    session: next,
    owners,
    mirrors,
    adopted: recorder,
  });
  try {
    await mirrors.bindRecorders(
      moved.filter((bound) => bound.recorder !== recorder),
    );
  } catch (error) {
    await restore();
    throw error;
  }
  return settledOnce(previous, [], host, restore, []);
}

/**
 * Stops the adopted recorder from being the primary (D-ORCH-11), inside one
 * turn of the queue. The published version is cloned into a file with no name
 * (design 4.8), which becomes the primary; the recorder's file is left as it
 * is, and nothing is written to it again, so the recorder can close it. The
 * recorders bound to the history move with the primary and stay bound. A
 * failure puts the adopted file back as the primary and closes the clone.
 */
export async function releaseAdoptedPrimary(
  host: AdoptionHost,
  retain?: BoundRecorder,
): Promise<void> {
  const previous = host.state();
  if (previous.adopted === undefined) {
    throw new Error('The primary journal is not an adopted recorder file');
  }
  if (!previous.mirrors.onlyRecorders) {
    throw new Error(
      'A history with mirrors that are not recorders cannot leave an adopted journal',
    );
  }
  await previous.mirrors.flush(true);
  const next = await previous.session.cloneUnlinked();
  const moved = await previous.mirrors.unbindRecorders();
  const owners = new JournalOwners(next.store);
  const mirrors = host.mirrorsOf(
    next,
    owners,
    previous.mirrors.retirementListeners,
  );
  mirrors.inheritPrimaryOrigin(previous.mirrors.primaryOriginId());
  host.install({
    ...previous,
    session: next,
    owners,
    mirrors,
    adopted: undefined,
  });
  try {
    await mirrors.bindRecorders(
      retain === undefined ? moved : [...moved, retain],
    );
  } catch (error) {
    await mirrors.unbindRecorders();
    host.install(previous);
    await previous.mirrors.bindRecorders(moved);
    await next.close();
    throw error;
  }
}

function settledOnce(
  previous: PrimaryState,
  replaced: readonly BoundRecorder[],
  host: AdoptionHost,
  restore: () => Promise<void>,
  retired: ReadonlyArray<() => void>,
): JournalAdoption {
  let settled = false;
  const settle = (): void => {
    if (settled) throw new Error('The adoption was already settled');
    settled = true;
  };
  return {
    rollback: async () => {
      settle();
      await host.drained();
      await restore();
    },
    commit: async () => {
      settle();
      // An adopted file is its recorder's; the recorder closes it.
      if (previous.adopted === undefined)
        await host.retirePrimary(previous.session);
      if (replaced.length > 0 || previous.adopted !== undefined) {
        previous.mirrors.fireRetired(retired);
      }
    },
  };
}
