/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalArrivalRecorder } from '../../journal/arrival-recorder.js';
import type {
  ArrivalAttempt,
  ArrivalBlock,
  ArrivalOutcome,
  ArrivalRow,
  ArrivalStore,
} from '../../journal/arrival-group.js';
import { ROW_BLOCK_TYPE, ROW_FLAG } from '../../journal/rowRecord.js';
import { encodeContentRow, flagsOf } from './journalRowCodec.js';
import type { ContentBlock, ContentMetadata, IContent } from './IContent.js';
import type { ToolArgumentDelta } from './tool-argument-delta.js';

export interface ResponseJournalIdentity {
  readonly transcriptId: string;
  readonly attemptId: string;
}

export interface ResponseArrival {
  readonly identity: ResponseJournalIdentity;
  selectAttempt(id: string | undefined, source?: 'transport'): Promise<void>;
  appendToolArguments(delta: ToolArgumentDelta): Promise<void>;
  replaceAfcHistory(contents: AsyncIterable<IContent>): Promise<void>;
  append(block: ContentBlock): void | Promise<void>;
  seal(
    metadata: ContentMetadata,
    afterAuxiliary?: () => Promise<void>,
    onSealed?: () => void | Promise<void>,
  ): Promise<void>;
  interrupt(outcome?: Exclude<ArrivalOutcome, 'completed'>): Promise<void>;
}

class JournalResponseArrival implements ResponseArrival {
  private current:
    | {
        readonly type: 'text' | 'thinking';
        readonly streamId?: string;
        readonly block: ArrivalBlock;
      }
    | undefined;
  private finished = false;
  private flags = 0;
  private afcGeneration = 0;
  private afcCount = 0;
  private afcFinished = 0;
  private toolAttemptId: string | undefined;
  private transportSelected = false;
  private rowAttemptId: string;
  constructor(
    private readonly recorder: JournalArrivalRecorder,
    private row: ArrivalRow,
    private content: IContent,
    private readonly owner: number,
    private readonly attempt: ArrivalAttempt,
  ) {
    this.rowAttemptId = attempt.id;
  }
  get identity(): ResponseJournalIdentity {
    return {
      transcriptId: this.row.transcriptId.toString(),
      attemptId: this.rowAttemptId,
    };
  }
  private async end(): Promise<void> {
    if (this.current === undefined) return;
    if (this.current.streamId === undefined)
      await this.recorder.endBlock(this.current.block);
    this.current = undefined;
  }
  append(block: ContentBlock): void | Promise<void> {
    if (this.finished) throw new Error('Response arrival is finished');
    this.flags |= flagsOf(
      { ...this.content, blocks: [block] },
      { owner: this.owner },
    );
    if (block.type === 'text' && this.current?.type === 'text')
      return this.recorder.appendTextDelta(this.current.block, block.text);
    return this.appendSlow(block);
  }
  private async appendSlow(block: ContentBlock): Promise<void> {
    if (block.type !== 'text' && block.type !== 'thinking') {
      await this.appendComplete(block);
      return;
    }
    const streamId = block.type === 'thinking' ? block.streamId : undefined;
    if (
      this.current?.type !== block.type ||
      this.current.streamId !== streamId ||
      (block.type === 'thinking' && streamId === undefined)
    ) {
      await this.end();
      this.current = {
        type: block.type,
        streamId,
        block:
          streamId === undefined
            ? await this.recorder.beginNamedBlock(
                this.row,
                ROW_BLOCK_TYPE[block.type],
              )
            : await this.recorder.indexedBlock(
                this.row,
                ROW_BLOCK_TYPE[block.type],
                streamId,
              ),
      };
    }
    if (block.type === 'text')
      await this.recorder.appendTextDelta(this.current.block, block.text);
    else {
      await this.recorder.appendText(
        this.current.block,
        'thought',
        block.thought,
        streamId === undefined ? 'delta' : 'snapshot',
      );
      await this.appendThinkingMetadata(block, this.current.block);
    }
  }
  async selectAttempt(
    id: string | undefined,
    source?: 'transport',
  ): Promise<void> {
    if (id === undefined || (source === undefined && this.transportSelected))
      return;
    if (source === 'transport') this.transportSelected = true;
    if (
      (source === 'transport' || this.toolAttemptId !== undefined) &&
      this.rowAttemptId !== id
    ) {
      await this.end();
      await this.finishAfc('superseded');
      await this.recorder.finishAttempt(this.row, 'superseded');
      this.flags = 0;
      this.content = {
        ...this.content,
        metadata: { ...this.content.metadata, id },
      };
      this.row = await this.recorder.beginRow(
        encodeContentRow(this.content, { owner: this.owner }),
        { ...this.attempt, id },
      );
      this.rowAttemptId = id;
    }
    this.toolAttemptId = id;
  }
  async appendToolArguments(delta: ToolArgumentDelta): Promise<void> {
    if (this.finished) throw new Error('Response arrival is finished');
    await this.selectAttempt(delta.attemptId);
    if (delta.contextOrder !== 'finalized' || delta.complete === true)
      await this.end();
    const handle = await this.recorder.indexedBlock(
      this.row,
      ROW_BLOCK_TYPE.tool_call,
      delta.sourceId,
    );
    await this.recorder.appendText(handle, 'id', delta.id, 'snapshot');
    if (delta.nameMode === 'replace')
      await this.recorder.replaceField(handle, 'name', delta.name);
    else await this.recorder.appendText(handle, 'name', delta.name, 'snapshot');
    await this.recorder.appendText(handle, 'parameters', delta.arguments);
    if (delta.replacementArguments !== undefined)
      await this.recorder.replaceField(
        handle,
        'parameters',
        delta.replacementArguments,
      );
    if (delta.complete === true) {
      this.flags |=
        ROW_FLAG.curated | ROW_FLAG.hasToolCall | ROW_FLAG.hasCacheableBlock;
      try {
        await this.recorder.endBlock(handle);
        if (delta.finalizedIndex !== undefined)
          await this.recorder.orderBlock(handle, delta.finalizedIndex);
      } catch (error) {
        this.finished = true;
        await this.recorder.close();
        throw error;
      }
    }
  }
  async replaceAfcHistory(contents: AsyncIterable<IContent>): Promise<void> {
    if (this.finished) throw new Error('Response arrival is finished');
    await this.end();
    await this.finishAfc('superseded');
    this.afcGeneration++;
    for await (const content of contents) {
      const row = await this.recorder.beginRow(
        {
          ...encodeContentRow(
            { ...content, blocks: [] },
            { owner: this.owner },
          ),
          flags: flagsOf(content, { owner: this.owner }),
        },
        {
          ...this.attempt,
          id: `${this.attempt.id}:afc:${this.afcGeneration}:${this.afcCount}`,
        },
      );
      await this.recorder.bindRow(
        this.row,
        `afc:${this.afcGeneration}:${this.afcCount}`,
        row,
      );
      this.afcCount++;
      for (const block of content.blocks)
        await this.appendCompleteToRow(row, block);
    }
  }
  private async finishAfc(
    outcome: ArrivalOutcome,
    afterAuxiliary?: () => Promise<void>,
  ): Promise<void> {
    for (let index = this.afcFinished; index < this.afcCount; index++) {
      const row = await this.recorder.lookupRow(
        this.row,
        `afc:${this.afcGeneration}:${index}`,
      );
      if (outcome === 'completed') {
        await this.recorder.sealRow(row);
        this.afcFinished = index + 1;
        await afterAuxiliary?.();
      } else {
        await this.recorder.finishAttempt(row, outcome);
        this.afcFinished = index + 1;
      }
    }
    this.afcCount = 0;
    this.afcFinished = 0;
  }
  private async appendThinkingMetadata(
    block: Extract<ContentBlock, { type: 'thinking' }>,
    handle: ArrivalBlock,
  ): Promise<void> {
    const fields: ReadonlyArray<
      | 'signature'
      | 'sourceField'
      | 'streamId'
      | 'encryptedContent'
      | 'streamStatus'
    > = [
      'signature',
      'sourceField',
      'streamId',
      'encryptedContent',
      'streamStatus',
    ];
    for (const name of fields) {
      const value = block[name];
      if (value !== undefined)
        await this.recorder.replaceField(handle, name, value);
    }
    if (block.isHidden !== undefined)
      await this.recorder.replaceField(
        handle,
        'isHidden',
        JSON.stringify(block.isHidden),
      );
    if (block.providerMetadata !== undefined)
      await this.recorder.replaceField(
        handle,
        'providerMetadata',
        JSON.stringify(block.providerMetadata),
      );
  }
  private async appendComplete(block: ContentBlock): Promise<void> {
    await this.end();
    await this.appendCompleteToRow(this.row, block);
  }
  private async appendCompleteToRow(
    row: ArrivalRow,
    block: ContentBlock,
  ): Promise<void> {
    const handle = await this.recorder.beginBlock(
      row,
      ROW_BLOCK_TYPE[block.type],
    );
    const bytes = new TextEncoder().encode(JSON.stringify(block));
    for (let at = 0; at < bytes.length; at += 65536)
      await this.recorder.appendField(handle, bytes.subarray(at, at + 65536));
    await this.recorder.endBlock(handle);
  }
  async seal(
    metadata: ContentMetadata,
    afterAuxiliary?: () => Promise<void>,
  ): Promise<void> {
    if (this.finished) throw new Error('Response arrival is finished');
    await this.end();
    await this.recorder.endRowBlocks(this.row);
    await this.finishAfc('completed', afterAuxiliary);
    const completedMetadata = { ...this.content.metadata, ...metadata };
    const draft = encodeContentRow(
      { ...this.content, metadata: completedMetadata },
      { owner: this.owner },
    );
    const parent =
      completedMetadata.responsesStored === true &&
      typeof completedMetadata.id === 'string' &&
      completedMetadata.id !== '' &&
      (this.flags & ROW_FLAG.curated) !== 0;
    await this.recorder.sealRow(this.row, completedMetadata, {
      flags: draft.flags | this.flags | (parent ? ROW_FLAG.responseParent : 0),
      parentEndpoint: draft.parentEndpoint,
    });
    this.finished = true;
    await this.recorder.close();
  }
  async interrupt(
    outcome: Exclude<ArrivalOutcome, 'completed'> = 'interrupted',
  ): Promise<void> {
    if (this.finished) return;
    await this.finishAfc(outcome);
    await this.recorder.finishAttempt(this.row, outcome);
    this.finished = true;
    await this.recorder.close();
  }
}

export async function openJournalResponseArrival(
  store: ArrivalStore,
  content: IContent,
  owner: number,
  attempt: ArrivalAttempt,
): Promise<ResponseArrival> {
  const recorder = new JournalArrivalRecorder(store);
  const row = await recorder.beginRow(
    encodeContentRow(content, { owner }),
    attempt,
  );
  return new JournalResponseArrival(recorder, row, content, owner, attempt);
}
