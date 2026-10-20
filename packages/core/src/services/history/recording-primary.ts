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

interface RecordingOwner {
  readonly recorder: JournalRecordingService;
  readonly origin: string | undefined;
  readonly owner: number;
}

export class RecordingPrimary {
  private pending: Omit<RecordingOwner, 'owner'> | undefined;
  private selected: RecordingOwner | undefined;

  constructor(private readonly host: AdoptionHost) {}

  attach(recorder: JournalRecordingService, origin: string | undefined): void {
    const { session, mirrors } = this.host.state();
    if (
      session.named ||
      session.store.published !== undefined ||
      mirrors.size !== 0
    )
      return;
    this.pending = { recorder, origin };
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
