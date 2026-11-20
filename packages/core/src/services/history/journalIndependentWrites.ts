/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { GroupPreparation } from '../../journal/preparedGroup.js';
import type { SourceRow, VersionEdit } from '../../journal/groupEdits.js';
import type { CommittedGroup } from '../../journal/journalStore.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import type { DetachedHistoryHost } from './detachedHistoryMutation.js';

interface AppendCapture {
  readonly snapshot: VersionSnapshot;
  readonly from: number;
}
interface ReplacementCapture {
  readonly snapshot: VersionSnapshot;
  readonly positions: ReadonlyMap<number, number>;
}

/** Holds versions and changed-row positions, never history values. */
export class JournalIndependentWrites {
  private readonly appends: AppendCapture[] = [];
  private readonly replacements: ReplacementCapture[] = [];
  private paused = false;

  async committed(
    group: CommittedGroup,
    edits: readonly VersionEdit[],
    snapshot: () => Promise<VersionSnapshot>,
  ): Promise<void> {
    if (this.paused || group.unchanged === true) return;
    const restoration = edits.find((edit) => edit.kind === 'restore');
    if (restoration?.kind === 'restore') {
      await this.discardAfter(restoration.saved.commitSeq);
      return;
    }
    if (
      group.streamedAppend === true ||
      edits.some((edit) => edit.kind === 'append' && edit.rows.length > 0)
    ) {
      this.appends.push({
        snapshot: await snapshot(),
        from: group.before?.rows ?? 0,
      });
    }
  }

  async replaced(
    positions: ReadonlyMap<number, number>,
    snapshot: () => Promise<VersionSnapshot>,
  ): Promise<void> {
    if (!this.paused && positions.size > 0)
      this.replacements.push({
        snapshot: await snapshot(),
        positions: new Map(positions),
      });
  }

  pause(): void {
    this.paused = true;
  }

  private async discardAfter(commitSeq: number): Promise<void> {
    for (const captures of [this.appends, this.replacements]) {
      for (let index = captures.length - 1; index >= 0; index--) {
        const captured = captures[index];
        if ((captured.snapshot.version?.commitSeq ?? 0) > commitSeq) {
          captures.splice(index, 1);
          await captured.snapshot.close();
        }
      }
    }
  }

  async replay(
    store: JournalHistoryStore,
    host: DetachedHistoryHost,
  ): Promise<void> {
    if (this.appends.length === 0 && this.replacements.length === 0) return;
    for (const captured of this.appends) {
      const { snapshot, from } = captured;
      let tokens = host.snapshot().tokens;
      for (let index = from; index < snapshot.rows; index++) {
        const row = decodeStoredRow(
          await snapshot.readRow(await snapshot.entryAt(index)),
        );
        host.chronology.stamp(row);
        tokens += await host.estimate([row]);
      }
      const prepare: GroupPreparation = async (group) => {
        await group.adopt(
          (async function* (): AsyncGenerator<SourceRow> {
            for (let index = from; index < snapshot.rows; index++)
              yield snapshot.sourceRow(await snapshot.entryAt(index));
          })(),
          snapshot.version?.nextLabel ?? 0n,
        );
      };
      await store.prepareDetached(prepare, [], true);
      host.apply(tokens, host.snapshot().spans);
    }
    const replacements = new Map<
      number,
      { snapshot: VersionSnapshot; ordinal: number }
    >();
    for (const capture of this.replacements)
      for (const [seq, ordinal] of capture.positions)
        replacements.set(seq, { snapshot: capture.snapshot, ordinal });
    if (replacements.size > 0) {
      await store.publishDetached(
        {
          transform: async (source, sink) => {
            let ordinal = 0;
            for await (const row of source.streamRows()) {
              const seq = row.metadata?.chronology?.seq;
              const replacement =
                seq === undefined ? undefined : replacements.get(seq);
              if (replacement === undefined)
                await sink.appendDerived(ordinal, row);
              else {
                const entry = await replacement.snapshot.entryAt(
                  replacement.ordinal,
                );
                await sink.appendReplacement(
                  ordinal,
                  decodeStoredRow(await replacement.snapshot.readRow(entry)),
                );
              }
              ordinal++;
            }
          },
        },
        host,
        undefined,
        {},
      );
    }
    if (host.mediaOwner !== undefined)
      await store.reconcileMedia(host.mediaOwner);
    host.notify(0, store.contextRange(host.snapshot().spans));
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.appends, ...this.replacements].map((capture) =>
        capture.snapshot.close(),
      ),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Independent journal writes cleanup failed',
      );
  }
}
