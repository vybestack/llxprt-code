/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from './groupEdits.js';
import type { TranscriptAppend } from './transcript-append.js';
import { prepareBuild, type PreparedBuild } from './preparedGroup.js';
import type { GroupPlan } from './groupPlanTypes.js';
import type { GroupRecord, RecordAppender } from './groupAppender.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import { mapReader } from './groupBuildShared.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import { TranscriptMapCache } from './transcript-cache.js';
import { frameLength } from './frame.js';
import { RECORD_KIND, MUTATION } from './recordKinds.js';
import { decodeRowHeader } from './rowRecord.js';
import { entryByLabel } from './rowTreeQueries.js';
import { iterateRowEntries } from './rowTreeReader.js';
import { rootRef } from './groupSegments.js';
import type { RowEntry } from './rowEntry.js';
import {
  TranscriptTreeWriter,
  type TranscriptEntry,
} from './transcript-tree.js';
import {
  TRANSCRIPT_HEAD_KEY,
  decodeTranscriptHead,
  encodeTranscriptHead,
  decodeMembership,
  encodeMembership,
  type TranscriptHead,
} from './transcript-head.js';

/** One group owns a bounded path cache; payload stays in its original ROW. */
export class TranscriptGroup {
  private readonly admissions: TranscriptAppend;
  private head: TranscriptHead;
  private readonly initialRoot: number;
  private readonly identities = new Map<number, bigint>();
  private readonly stateCache: TranscriptMapCache;
  private readonly metaCache: TranscriptMapCache;
  private constructor(
    private readonly ctx: BuildContext,
    private readonly target: RecordAppender,
    head: TranscriptHead,
  ) {
    this.stateCache = new TranscriptMapCache(ctx.stateCache);
    this.metaCache = new TranscriptMapCache(ctx.metaCache);
    this.head = head;
    this.initialRoot = head.root;
    this.admissions = new TranscriptTreeWriter(
      () => ctx.readGroup(target.nextOffset),
      target,
      'transcript',
      ctx.stateCache,
    ).appendGroup(head.root);
  }
  static async start(
    ctx: BuildContext,
    target: RecordAppender,
  ): Promise<TranscriptGroup> {
    const bytes = await mapReader(ctx, 'state').get(
      ctx.published?.roots.stateRoot ?? 0,
      TRANSCRIPT_HEAD_KEY,
    );
    return new TranscriptGroup(ctx, target, decodeTranscriptHead(bytes));
  }
  appender(): RecordAppender {
    const target = this.target;
    return {
      transcriptIdentity: (offset) => {
        const id = this.identities.get(offset);
        if (id === undefined)
          throw new Error('New ROW has no transcript identity');
        return id;
      },
      retainsSource: (source) =>
        source.sourceIdentity !== undefined &&
        source.sourceIdentity === this.ctx.access?.sourceIdentity,
      get nextOffset() {
        return target.nextOffset;
      },
      append: (record) => this.append(record),
      drain: () => target.drain(),
    };
  }
  metadataAppender(target: RecordAppender): RecordAppender {
    return {
      get nextOffset() {
        return target.nextOffset;
      },
      drain: () => target.drain(),
      append: async (record) => {
        const offset = await target.append(record);
        this.observe(record, offset);
        return offset;
      },
    };
  }

  private observe(record: GroupRecord, rowRef: number): void {
    if (record.kind === RECORD_KIND.ITNODE) {
      this.stateCache.put(rowRef, record.kindHeader);
      this.metaCache.put(rowRef, record.kindHeader);
    }
    const chunks = record.body?.chunks;
    if (
      record.kind === RECORD_KIND.VALUE &&
      Array.isArray(chunks) &&
      chunks.length === 1 &&
      chunks[0] instanceof Uint8Array
    ) {
      this.stateCache.put(rowRef, chunks[0]);
      this.metaCache.put(rowRef, chunks[0]);
    }
  }

  private async append(record: GroupRecord): Promise<number> {
    const rowRef = await this.target.append(record);
    this.observe(record, rowRef);
    if (record.kind !== RECORD_KIND.ROW) return rowRef;
    const row = decodeRowHeader(record.kindHeader);
    let supersedesId = 0n;
    if (
      this.ctx.published !== undefined &&
      this.ctx.access !== undefined &&
      row.label < this.ctx.published.nextLabel
    ) {
      const old = await entryByLabel(
        this.ctx.access,
        rootRef(this.ctx.published),
        row.label,
      );
      if (old !== undefined) supersedesId = old.transcriptId;
    }
    await this.admit({
      transcriptId: this.head.nextId,
      rowRef,
      label: row.label,
      recordLength: frameLength(
        record.kindHeader.length,
        record.body?.length ?? 0,
      ),
      revision: 1,
      audience: 0,
      status: 1,
      attemptRef: 0,
      supersedesId,
      presentationRef: 0,
    });
    return rowRef;
  }
  private async admit(entry: TranscriptEntry): Promise<void> {
    await this.admissions.append(entry);
    if (entry.rowRef !== 0) {
      if (this.identities.size >= 64)
        this.identities.delete(this.identities.keys().next().value ?? 0);
      this.identities.set(entry.rowRef, entry.transcriptId);
    }
    this.head = {
      ...this.head,
      nextId: entry.transcriptId + 1n,
      count: this.head.count + 1,
      reachableBytes: this.head.reachableBytes + entry.recordLength + 64,
    };
  }
  private reader(kind: 'state' | 'meta'): KeyedMapReader {
    return new KeyedMapReader(
      this.ctx.readGroup(this.target.nextOffset),
      kind === 'state' ? this.stateCache : this.metaCache,
      kind,
      this.ctx.hasher,
    );
  }
  async finish(
    built: BuiltGroup,
    plan: GroupPlan,
    edits: readonly VersionEdit[],
  ): Promise<BuiltGroup> {
    const mutation = built.state.mutation;
    if (
      mutation === MUTATION.pop ||
      mutation === MUTATION.clear ||
      mutation === MUTATION.restore ||
      edits.some((edit) => edit.kind === 'density' && edit.removed.length > 0)
    )
      await this.marker(built);
    this.head = { ...this.head, root: await this.admissions.finish() };
    const state = new KeyedMapBatch(
      this.reader('state'),
      built.state.stateRoot,
      this.stateCache,
    );
    if (this.head.root !== this.initialRoot)
      state.set(TRANSCRIPT_HEAD_KEY, encodeTranscriptHead(this.head));
    const stateRoot = await state.commit(this.appender());
    const metaRoot = await this.members(built, plan);
    return {
      ...built,
      groupCaches: { metaCache: this.metaCache, stateCache: this.stateCache },
      state: { ...built.state, stateRoot, metaRoot },
    };
  }
  private async marker(built: BuiltGroup): Promise<void> {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        mutation: built.state.mutation,
        version: this.ctx.published?.commitSeq ?? 0,
        cut: built.state.mutationArg0.toString(),
      }),
    );
    const presentationRef = await this.target.append({
      kind: RECORD_KIND.VALUE,
      kindHeader: new TextEncoder().encode('transcript:operation'),
      body: { length: bytes.length, chunks: [bytes] },
    });
    await this.admit({
      transcriptId: this.head.nextId,
      rowRef: 0,
      recordLength: bytes.length,
      label: 0n,
      revision: 1,
      audience: 2,
      status: 1,
      attemptRef: 0,
      supersedesId: 0n,
      presentationRef,
    });
  }
  private async members(built: BuiltGroup, plan: GroupPlan): Promise<number> {
    if (
      built.state.rowRoot === 0 ||
      built.state.rowRoot === plan.base.roots.rowRoot
    )
      return built.state.metaRoot;
    if (built.changedRows === undefined) await this.target.drain();
    const meta = new KeyedMapBatch(
      this.reader('meta'),
      built.state.metaRoot,
      this.metaCache,
    );
    const access = () => this.ctx.readGroup(this.target.nextOffset);
    const occurrences = new TranscriptTreeWriter(
      access,
      this.target,
      'membership',
    );
    const incremental = built.changedRows !== undefined;
    const rows =
      built.changedRows ??
      iterateRowEntries(
        access(),
        {
          offset: built.state.rowRoot,
          rows: built.state.rootAggregate.rows,
        },
        !plan.rebuilt && plan.segments === undefined ? plan.base.rows : 0,
      );
    for await (const entry of rows) {
      const id = entry.transcriptId;
      if (id === 0n) throw new Error('Context row has no transcript identity');
      if (incremental) await this.excludePrevious(meta, entry, id);
      const key = `member:${id}`;
      const previous = decodeMembership(await meta.get(key));
      const selected =
        previous.occurrencesRoot === 0
          ? undefined
          : (
              await occurrences
                .entries(previous.occurrencesRoot, entry.label)
                .next()
            ).value;
      if (
        selected?.label !== entry.label ||
        selected.rowRef !== entry.recordOffset
      ) {
        const occurrence = {
          transcriptId: entry.label,
          rowRef: entry.recordOffset,
          recordLength: 0,
          label: entry.label,
          revision: 1,
          audience: 0,
          status: 1,
          attemptRef: 0,
          supersedesId: 0n,
          presentationRef: 0,
        };
        const root = previous.count === 0 ? 0 : previous.occurrencesRoot;
        const occurrencesRoot = await occurrences.insert(root, occurrence);
        meta.set(
          key,
          encodeMembership({
            count: previous.count + 1,
            label: entry.label,
            rowRef: entry.recordOffset,
            occurrencesRoot,
          }),
        );
      }
      await meta.spillWhenFull(this.appender(), this.ctx.readGroup);
    }
    return meta.commit(this.appender());
  }
  private async excludePrevious(
    meta: KeyedMapBatch,
    entry: RowEntry,
    id: bigint,
  ): Promise<void> {
    const { published, access } = this.ctx;
    if (
      published === undefined ||
      access === undefined ||
      entry.label >= published.nextLabel
    )
      return;
    const old = await entryByLabel(access, rootRef(published), entry.label);
    if (old === undefined || old.recordOffset === entry.recordOffset) return;
    const oldId = old.transcriptId;
    if (oldId === id) return;
    const key = `member:${oldId}`;
    const previous = decodeMembership(await meta.get(key));
    const tree = new TranscriptTreeWriter(
      () => this.ctx.readGroup(this.target.nextOffset),
      this.target,
      'membership',
    );
    const occurrencesRoot = await tree.remove(
      previous.occurrencesRoot,
      entry.label,
    );
    const first = await tree.entries(occurrencesRoot, 0n).next();
    meta.set(
      key,
      encodeMembership({
        count: previous.count - 1,
        label: first.value?.label ?? 0n,
        rowRef: first.value?.rowRef ?? 0,
        occurrencesRoot,
      }),
    );
  }
}

export async function prepareTranscriptBuild(
  ...args: Parameters<typeof prepareBuild>
): Promise<PreparedBuild> {
  const [ctx, planning, edits, appender, rowAppender, register] = args;
  const transcript = await TranscriptGroup.start(ctx, rowAppender);
  const prepared = await prepareBuild(
    ctx,
    planning,
    edits,
    transcript.metadataAppender(appender),
    transcript.appender(),
    register,
    rowAppender,
  );
  if (
    prepared.recording === true ||
    prepared.built === undefined ||
    prepared.plan === undefined
  )
    return prepared;
  const plan = prepared.plan;
  return {
    ...prepared,
    built: {
      ...prepared.built,
      finishTranscript: (built) =>
        transcript.finish(built, plan, prepared.edits),
    },
  };
}

export async function finishTranscript(built: BuiltGroup): Promise<BuiltGroup> {
  if (built.finishTranscript === undefined) return built;
  const result = await built.finishTranscript(built);
  return { ...result, finishTranscript: undefined };
}
