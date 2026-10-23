/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import {
  adoptAttachedRecorder,
  releaseAdoptedPrimary,
  type AdoptionHost,
} from './journalAdoption.js';
import {
  checkedRecordingEdits,
  recordingAcceptsEdits,
} from './recording-primary-edits.js';

import type { PendingRecorderWrites } from './pendingRecorderWrites.js';

interface RecordingOwner {
  readonly recorder: JournalRecordingService;
  readonly origin: string | undefined;
  readonly owner: number;
}

export class RecordingPrimary {
  private pending: Omit<RecordingOwner, 'owner'> | undefined;
  private selected: RecordingOwner | undefined;

  constructor(private readonly host: AdoptionHost) {}

  async attach(
    recorder: JournalRecordingService,
    origin: string | undefined,
  ): Promise<void> {
    const current = this.host.state();
    if (
      current.adopted !== undefined &&
      current.adopted !== recorder &&
      current.mirrors.primaryOriginId() === origin
    ) {
      await releaseAdoptedPrimary(this.host);
      this.selected = undefined;
    }
    const { session, mirrors } = this.host.state();
    if (
      session.named ||
      session.store.published !== undefined ||
      mirrors.size !== 0
    )
      return;
    this.pending = { recorder, origin };
  }

  async detach(
    writes: PendingRecorderWrites,
    failure: { readonly error: unknown; reported?: boolean } | undefined,
  ): Promise<void> {
    await writes.settle();
    await releaseAdoptedPrimary(this.host);
    if (failure !== undefined && failure.reported !== true) {
      failure.reported = true;
      throw failure.error;
    }
  }

  acceptsPreview(origin: string | undefined): boolean {
    return (
      this.selected === undefined ||
      origin === undefined ||
      origin === this.selected.origin
    );
  }

  async prepare(
    edits: readonly VersionEdit[],
  ): Promise<readonly VersionEdit[]> {
    const state = this.host.state();
    if (this.selected !== undefined && state.adopted !== this.selected.recorder)
      this.selected = undefined;
    if (this.selected === undefined && state.adopted !== undefined) {
      const origin = state.mirrors.primaryOriginId();
      if (origin === undefined) return edits;
      const { id: owner } = await state.owners.resolve(origin);
      this.selected = { recorder: state.adopted, origin, owner };
    }
    const selected = this.selected;
    if (selected !== undefined) {
      const streams = await state.owners.hasOnly(selected.origin);
      if (
        recordingAcceptsEdits(edits, selected.owner, selected.origin, streams)
      )
        return checkedRecordingEdits(edits, selected.owner);
      await releaseAdoptedPrimary(this.host, {
        recorder: selected.recorder,
        session: state.session,
        origin: selected.origin,
      });
      this.selected = undefined;
    }
    const pending = this.pending;
    this.pending = undefined;
    if (
      pending === undefined ||
      !state.mirrors.isOnlyRecorder(pending.recorder)
    )
      return edits;
    const { id: owner } = await state.owners.resolve(pending.origin);
    if (
      !edits.some((edit) => edit.kind === 'append') ||
      !recordingAcceptsEdits(edits, owner, pending.origin, false)
    )
      return edits;
    await state.mirrors.materializeRecorders();
    const adoption = await adoptAttachedRecorder(this.host, pending.recorder);
    this.selected = { ...pending, owner };
    await adoption.commit();
    return edits;
  }
}
