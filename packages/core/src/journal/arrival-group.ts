/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import { mapReader } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { buildGroup } from './groupBuild.js';
import { planGroup } from './groupPlan.js';
import { FIRST_NEXT_LABEL, allocateAppendLabels } from './labels.js';
import { MUTATION, RECORD_KIND } from './recordKinds.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import { frameLength } from './frame.js';
import {
  decodeRowHeader,
  encodeRowHeader,
  type RowHeader,
  ROW_BLOCK_TYPE,
  ROW_FLAG,
} from './rowRecord.js';
import { encodeRowDraft, entryForNewRow, type RowDraft } from './rowDraft.js';
import { buildStreamedAppend } from './streamed-append-build.js';
import type { AppendInput } from './streamed-append-pass.js';
import {
  TranscriptTreeWriter,
  transcriptEntries,
  type TranscriptEntry,
} from './transcript-tree.js';
import {
  TRANSCRIPT_HEAD_KEY,
  decodeTranscriptHead,
  encodeTranscriptHead,
  encodeMembership,
} from './transcript-head.js';
import {
  appendChunkValue,
  chunkBlock,
  chunkValue,
  decodeChunkBlock,
  directoryEntry,
  encodeChunkBlock,
  findChunkEntry,
  pieceHeader,
  readChunkBlock,
  hydrateChunkHeader,
} from './chunk-row.js';
import type { ChunkBlock } from './chunk-row.js';
import { fieldCode, type ArrivalFieldName } from './chunk-fields.js';
import type { CommitAck } from './groupWriter.js';

export interface ArrivalRow {
  readonly transcriptId: bigint;
}
export interface ArrivalBlock extends ArrivalRow {
  readonly ordinal: number;
}
export interface ArrivalAttempt {
  readonly id: string;
  readonly submissionId: string;
}
export interface ArrivalPiece {
  readonly block: ArrivalBlock;
  readonly bytes: Uint8Array;
}
export type ArrivalOutcome =
  | 'completed'
  | 'cancelled'
  | 'error'
  | 'interrupted'
  | 'superseded';
export const ARRIVAL_STATUS = {
  completed: 1,
  cancelled: 2,
  error: 3,
  interrupted: 4,
  superseded: 5,
};
export interface RecordingMutation<T> {
  readonly built: BuiltGroup;
  readonly value: T;
}
export interface ArrivalStore {
  mutateRecording<T>(
    build: (
      ctx: BuildContext,
      target: RecordAppender,
    ) => Promise<RecordingMutation<T>>,
  ): Promise<{ readonly value: T; readonly ack: CommitAck }>;
  pin(): Promise<() => void | Promise<void>>;
}

export class ArrivalGroup {
  private outcome:
    | { readonly key: string; readonly bytes: Uint8Array }
    | undefined;
  private constructor(
    readonly ctx: BuildContext,
    readonly target: RecordAppender,
    private built: BuiltGroup,
    private head: ReturnType<typeof decodeTranscriptHead>,
  ) {}
  static async start(
    ctx: BuildContext,
    target: RecordAppender,
  ): Promise<ArrivalGroup> {
    const plan = await planGroup(
      {
        access: ctx.access,
        published: ctx.published,
        readVersion: async () => {
          throw new Error('Recording does not restore');
        },
        firstNextLabel: FIRST_NEXT_LABEL,
        readState: (key) =>
          mapReader(ctx, 'state').get(ctx.published?.roots.stateRoot ?? 0, key),
      },
      [{ kind: 'append', rows: [] }],
    );
    const built = await buildGroup(ctx, plan, MUTATION.state, target);
    const head = decodeTranscriptHead(
      await mapReader(ctx, 'state').get(
        ctx.published?.roots.stateRoot ?? 0,
        TRANSCRIPT_HEAD_KEY,
      ),
    );
    return new ArrivalGroup(ctx, target, built, head);
  }
  private access() {
    return this.ctx.readGroup(this.target.nextOffset);
  }
  private tree(
    mode: 'transcript' | 'blocks' | 'pieces' | 'open' | 'membership',
  ) {
    return new TranscriptTreeWriter(() => this.access(), this.target, mode);
  }
  async find(
    row: ArrivalRow,
  ): Promise<{ entry: TranscriptEntry; header: RowHeader }> {
    await this.target.drain();
    const entry = await findChunkEntry(
      this.access(),
      this.head.root,
      'transcript',
      row.transcriptId,
    );
    const header = decodeRowHeader(
      (await this.access().readRecordHead(entry.rowRef, 'ROW')).kindHeader,
    );
    if (header.chunk === undefined || entry.status !== 0)
      throw new Error('Recording row is not in progress');
    return { entry, header };
  }
  async begin(draft: RowDraft, attempt: ArrivalAttempt): Promise<ArrivalRow> {
    if (draft.blocks.length !== 0 || draft.ids.length !== 0)
      throw new Error('Arrival rows begin without blocks or ids');
    const id = this.head.nextId;
    const metaRef = await appendChunkValue(
      this.target,
      'recording:metadata',
      draft.meta,
    );
    const attemptRef = await appendChunkValue(
      this.target,
      'recording:attempt',
      new TextEncoder().encode(JSON.stringify(attempt)),
    );
    const header = {
      ...encodeRowDraft(0n, draft).header,
      chunk: { transcriptId: id, blocksRoot: 0, metaRef, blockCount: 0 },
    };
    const entry = { ...directoryEntry(id, 0), attemptRef };
    this.head = { ...this.head, nextId: id + 1n, count: this.head.count + 1 };
    await this.publish(entry, header);
    return { transcriptId: id };
  }
  async beginBlock(
    row: ArrivalRow,
    type: number,
    named = false,
  ): Promise<ArrivalBlock> {
    const { entry, header } = await this.find(row);
    if (header.chunk === undefined) throw new Error('Missing manifest');
    const ordinal = header.chunk.blockCount;
    let flag = 0;
    if (type === ROW_BLOCK_TYPE.thinking) flag = ROW_FLAG.hasThinking;
    if (type === ROW_BLOCK_TYPE.tool_call) flag = ROW_FLAG.hasToolCall;
    if (type === ROW_BLOCK_TYPE.media) flag = ROW_FLAG.hasMedia;
    const ref = await appendChunkValue(
      this.target,
      'recording:block',
      encodeChunkBlock({ piecesRoot: 0, length: 0, type, ended: false, named }),
    );
    const blocksRoot = await this.tree('blocks').insert(
      header.chunk.blocksRoot,
      directoryEntry(BigInt(ordinal + 1), ref),
    );
    await this.publish(entry, {
      ...header,
      flags: header.flags | flag,
      chunk: { ...header.chunk, blocksRoot, blockCount: ordinal + 1 },
    });
    return { ...row, ordinal };
  }
  async namedField(
    handle: ArrivalBlock,
    name: ArrivalFieldName,
  ): Promise<ChunkBlock | undefined> {
    const { header } = await this.find(handle);
    if (header.chunk === undefined) throw new Error('Missing manifest');
    const block = await chunkBlock(this.access(), header.chunk, handle.ordinal);
    if (block.named !== true || block.ended)
      throw new Error('Named block is not open');
    const found = await transcriptEntries(
      this.access(),
      block.piecesRoot,
      'blocks',
      BigInt(fieldCode(name)),
      false,
    ).next();
    return found.value?.transcriptId === BigInt(fieldCode(name))
      ? decodeChunkBlock(await chunkValue(this.access(), found.value.rowRef))
      : undefined;
  }
  async appendNamed(
    handle: ArrivalBlock,
    name: ArrivalFieldName,
    bytes: Uint8Array,
    snapshot?: ChunkBlock['snapshot'],
  ): Promise<void> {
    const { entry, header } = await this.find(handle);
    if (header.chunk === undefined) throw new Error('Missing manifest');
    const block = await chunkBlock(this.access(), header.chunk, handle.ordinal);
    const code = fieldCode(name);
    const field = (await this.namedField(handle, name)) ?? {
      piecesRoot: 0,
      length: 0,
      type: code,
      ended: false,
    };
    let piecesRoot = field.piecesRoot;
    if (bytes.length > 0) {
      const ref = await this.target.append({
        kind: RECORD_KIND.PIECE,
        kindHeader: pieceHeader(
          entry.transcriptId,
          handle.ordinal,
          field.length,
          code,
        ),
        body: { length: bytes.length, chunks: [bytes] },
      });
      piecesRoot = await this.tree('pieces').insert(
        piecesRoot,
        directoryEntry(BigInt(field.length + 1), ref, bytes.length),
      );
    }
    const fieldRef = await appendChunkValue(
      this.target,
      'recording:block',
      encodeChunkBlock({
        ...field,
        piecesRoot,
        length: field.length + bytes.length,
        snapshot: snapshot ?? field.snapshot,
      }),
    );
    const fieldsRoot = await this.tree('blocks').insert(
      block.piecesRoot,
      directoryEntry(BigInt(code), fieldRef),
    );
    const descriptor = await appendChunkValue(
      this.target,
      'recording:block',
      encodeChunkBlock({
        ...block,
        piecesRoot: fieldsRoot,
        length: block.length + bytes.length,
      }),
    );
    const blocksRoot = await this.tree('blocks').insert(
      header.chunk.blocksRoot,
      directoryEntry(BigInt(handle.ordinal + 1), descriptor),
    );
    this.head = {
      ...this.head,
      reachableBytes: this.head.reachableBytes + bytes.length,
    };
    await this.publish(entry, {
      ...header,
      chunk: { ...header.chunk, blocksRoot },
    });
  }
  async append(piece: ArrivalPiece): Promise<void> {
    const { entry, header } = await this.find(piece.block);
    if (header.chunk === undefined) throw new Error('Missing manifest');
    const block = await chunkBlock(
      this.access(),
      header.chunk,
      piece.block.ordinal,
    );
    if (block.ended) throw new Error('Cannot append to an ended block');
    const ref = await this.target.append({
      kind: RECORD_KIND.PIECE,
      kindHeader: pieceHeader(
        entry.transcriptId,
        piece.block.ordinal,
        block.length,
      ),
      body: { length: piece.bytes.length, chunks: [piece.bytes] },
    });
    const piecesRoot = await this.tree('pieces').insert(
      block.piecesRoot,
      directoryEntry(BigInt(block.length + 1), ref, piece.bytes.length),
    );
    const descriptor = await appendChunkValue(
      this.target,
      'recording:block',
      encodeChunkBlock({
        ...block,
        piecesRoot,
        length: block.length + piece.bytes.length,
      }),
    );
    const blocksRoot = await this.tree('blocks').insert(
      header.chunk.blocksRoot,
      directoryEntry(BigInt(piece.block.ordinal + 1), descriptor),
    );
    this.head = {
      ...this.head,
      reachableBytes: this.head.reachableBytes + piece.bytes.length,
    };
    await this.publish(entry, {
      ...header,
      chunk: { ...header.chunk, blocksRoot },
    });
  }
  async blockError(handle: ArrivalBlock): Promise<string | undefined> {
    const { header } = await this.find(handle);
    if (header.chunk === undefined) throw new Error('Missing manifest');
    const block = await chunkBlock(this.access(), header.chunk, handle.ordinal);
    if (block.named !== true || block.type !== 1) return undefined;
    try {
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await readChunkBlock(this.access(), header.chunk, handle.ordinal),
        ),
      );
      if (value === null || typeof value !== 'object')
        return 'Invalid tool call';
      if (!('id' in value) || typeof value.id !== 'string' || value.id === '')
        return 'Invalid tool call id';
      if (
        !('name' in value) ||
        typeof value.name !== 'string' ||
        value.name === ''
      )
        return 'Invalid tool call name';
      if (!('parameters' in value)) return 'Invalid tool call';
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return 'Invalid tool call arguments';
    }
    return undefined;
  }
  async endBlock(handle: ArrivalBlock): Promise<void> {
    const { entry, header } = await this.find(handle);
    if (header.chunk === undefined) throw new Error('Missing manifest');
    const block = await chunkBlock(this.access(), header.chunk, handle.ordinal);
    const descriptor = await appendChunkValue(
      this.target,
      'recording:block',
      encodeChunkBlock({ ...block, ended: true }),
    );
    const blocksRoot = await this.tree('blocks').insert(
      header.chunk.blocksRoot,
      directoryEntry(BigInt(handle.ordinal + 1), descriptor),
    );
    await this.publish(entry, {
      ...header,
      chunk: { ...header.chunk, blocksRoot },
    });
  }
  async finish(
    row: ArrivalRow,
    outcome: ArrivalOutcome,
    metadata?: Uint8Array,
  ): Promise<void> {
    let { entry, header } = await this.find(row);
    if (header.chunk === undefined) throw new Error('Missing manifest');
    if (outcome === 'completed') {
      for await (const block of transcriptEntries(
        this.access(),
        header.chunk.blocksRoot,
        'blocks',
        0n,
        false,
      ))
        if (
          !decodeChunkBlock(await chunkValue(this.access(), block.rowRef)).ended
        )
          throw new Error('Cannot seal an open block');
      const allocated = allocateAppendLabels(this.built.state.nextLabel, 1);
      header = { ...header, label: allocated.labels[0] };
    }
    if (header.chunk === undefined) throw new Error('Missing manifest');
    if (metadata !== undefined)
      header = {
        ...header,
        chunk: {
          ...header.chunk,
          metaRef: await appendChunkValue(
            this.target,
            'recording:metadata',
            metadata,
          ),
        },
      };
    const attempt: unknown = JSON.parse(
      new TextDecoder().decode(
        await chunkValue(this.access(), entry.attemptRef),
      ),
    );
    if (
      typeof attempt !== 'object' ||
      attempt === null ||
      !('id' in attempt) ||
      typeof attempt.id !== 'string'
    )
      throw new Error('Invalid recording attempt');
    this.outcome = {
      key: `attempt:${attempt.id}:outcome`,
      bytes: new TextEncoder().encode(JSON.stringify({ outcome })),
    };
    entry = await this.publish(
      { ...entry, status: ARRIVAL_STATUS[outcome] },
      header,
    );
    if (outcome === 'completed') await this.admit(entry, header);
  }
  private async admit(
    entry: TranscriptEntry,
    header: RowHeader,
  ): Promise<void> {
    const plan = await planGroup(
      {
        access: this.ctx.access,
        published: this.ctx.published,
        readVersion: async () => {
          throw new Error('Cannot restore');
        },
        firstNextLabel: FIRST_NEXT_LABEL,
        readState: async () => undefined,
      },
      [{ kind: 'append', rows: [] }],
    );
    await this.target.drain();
    const source = this.access();
    const row = entryForNewRow(
      {
        header: await hydrateChunkHeader(source, header),
        recordLength: entry.recordLength,
      },
      entry.rowRef,
      entry.transcriptId,
    );
    const inputs = (async function* (): AsyncGenerator<AppendInput> {
      yield { existing: { source, entry: row } };
    })();
    const nextLabel = allocateAppendLabels(plan.nextLabel, 1).nextLabel;
    const built = await buildStreamedAppend(
      this.ctx,
      plan,
      MUTATION.append,
      this.target,
      inputs,
      nextLabel,
    );
    if (built === undefined) throw new Error('Sealing produced no context row');
    const occurrencesRoot = await this.tree('membership').insert(0, {
      ...entry,
      transcriptId: row.label,
    });
    await this.target.drain();
    const meta = new KeyedMapBatch(
      new KeyedMapReader(
        this.access(),
        this.ctx.metaCache,
        'meta',
        this.ctx.hasher,
      ),
      built.state.metaRoot,
    );
    meta.set(
      `member:${entry.transcriptId}`,
      encodeMembership({
        count: 1,
        label: row.label,
        rowRef: entry.rowRef,
        occurrencesRoot,
      }),
    );
    this.built = {
      ...built,
      state: { ...built.state, metaRoot: await meta.commit(this.target) },
    };
  }
  private async publish(
    entry: TranscriptEntry,
    header: RowHeader,
  ): Promise<TranscriptEntry> {
    const kindHeader = encodeRowHeader(header);
    const rowRef = await this.target.append({
      kind: RECORD_KIND.ROW,
      kindHeader,
    });
    const updated = {
      ...entry,
      rowRef,
      label: header.label,
      revision: entry.revision + 1,
      recordLength: frameLength(kindHeader.length, 0),
    };
    const root = await this.tree('transcript').insert(this.head.root, updated);
    const openRoot =
      updated.status === 0
        ? await this.tree('open').insert(this.head.openRoot, updated)
        : await this.tree('open').remove(
            this.head.openRoot,
            updated.transcriptId,
          );
    this.head = { ...this.head, root, openRoot };
    return updated;
  }
  async complete<T>(value: T): Promise<RecordingMutation<T>> {
    const state = new KeyedMapBatch(
      mapReader(this.ctx, 'state'),
      this.built.state.stateRoot,
    );
    state.set(TRANSCRIPT_HEAD_KEY, encodeTranscriptHead(this.head));
    if (this.outcome !== undefined)
      state.set(this.outcome.key, this.outcome.bytes);
    return {
      value,
      built: {
        ...this.built,
        state: {
          ...this.built.state,
          stateRoot: await state.commit(this.target),
        },
      },
    };
  }
}
