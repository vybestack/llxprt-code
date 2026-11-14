/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { decodeStoredRow } from './journalRowCodec.js';
import { encodeRowDraft } from '../../journal/rowDraft.js';
import type { IContent } from './IContent.js';
import type { JournalStore } from '../../journal/journalStore.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import type { EditBuilder } from './journalPublication.js';
import type { JournalOwners } from './journalOwners.js';

export function decodeTokenDraft(draft: RowDraft): IContent {
  return decodeStoredRow({
    header: encodeRowDraft(1n, draft).header,
    rawIds: draft.ids.map((id) => id.rawId),
    meta: draft.meta,
    blocks: draft.blocks.map((block) => block.bytes),
  });
}

export interface TokenDraft {
  readonly sequence: number;
  readonly draft: RowDraft;
  captured: boolean;
}

export function releaseUnclaimedTokenDraft(
  draft: TokenDraft | undefined,
  sequence: number,
): TokenDraft | undefined {
  return draft !== undefined && !draft.captured && draft.sequence <= sequence
    ? undefined
    : draft;
}

export interface AppendAdmissionRun {
  readonly store: JournalStore;
  readonly releaseReader: () => void | Promise<void>;
  readonly start: number;
  end: number;
  count: number;
  rowsAfter: number;
  tokenSequence: number;
  readonly origin: string | undefined;
}
interface AdmissionHost {
  owners(): JournalOwners;
  commit(rowsAfter: number, build: EditBuilder): Promise<CommitAck>;
}

async function commitFirst(
  run: AppendAdmissionRun,
  rows: AsyncGenerator<RowDraft>,
  host: AdmissionHost,
  rowsAfter = run.rowsAfter - run.count + 1,
): Promise<void> {
  const first = await rows.next();
  if (first.done === true) throw new Error('Journal admission range is empty');
  const owner = await host.owners().resolve(run.origin);
  await host.commit(rowsAfter, async () => [
    ...owner.edits,
    { kind: 'append', rows: [{ ...first.value, owner: owner.id }] },
  ]);
}

/** The leading mutation starts immediately; queued appends share the suffix group. */
export async function commitAdmittedAppend(
  run: AppendAdmissionRun,
  host: AdmissionHost,
): Promise<void> {
  const rows = run.store.admissions.rows(run.start, run.end);
  try {
    await commitFirst(run, rows, host);
    if (run.count === 1) return;
    if (run.count === 2) {
      await commitFirst(run, rows, host, run.rowsAfter);
      return;
    }
    const owner = await host.owners().resolve(run.origin);
    const remaining = async function* (): AsyncGenerator<RowDraft> {
      let count = 1;
      for await (const draft of rows) {
        count++;
        yield { ...draft, owner: owner.id };
      }
      if (count !== run.count)
        throw new Error('Journal admission row count mismatch');
    };
    await host.commit(run.rowsAfter, async () => [
      {
        kind: 'prepared',
        admission: [...owner.edits, { kind: 'append', rows: [] }],
        prepare: (group) => group.append(remaining(), owner.edits),
      },
    ]);
  } finally {
    await rows.return(undefined);
  }
}

export class StartupAdmissions {
  private count = 0;
  private bytes = 0;
  constructor(
    private readonly host: {
      rows(): number;
      enqueue(rowsAfter: number, build: EditBuilder): void;
      owners(): JournalOwners;
    },
  ) {}

  append(draft: RowDraft, origin: string | undefined): void {
    const bytes =
      draft.meta.length +
      draft.blocks.reduce((sum, block) => sum + block.bytes.length, 0);
    if (this.count >= 32 || this.bytes + bytes > 256 * 1024)
      throw new Error('Journal startup admission budget exceeded');
    this.count++;
    this.bytes += bytes;
    this.host.enqueue(this.host.rows() + 1, async () => {
      this.count--;
      this.bytes -= bytes;
      const owner = await this.host.owners().resolve(origin);
      return [
        ...owner.edits,
        { kind: 'append', rows: [{ ...draft, owner: owner.id }] },
      ];
    });
  }
}
