/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalArrivalRecorder } from '../../journal/arrival-recorder.js';
import type {
  ArrivalAttempt,
  ArrivalBlock,
  ArrivalOutcome,
  ArrivalRow,
  ArrivalStore,
} from '../../journal/arrival-group.js';
import { ROW_BLOCK_TYPE } from '../../journal/rowRecord.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { ContentBlock, ContentMetadata, IContent } from './IContent.js';

export interface ResponseArrival {
  append(block: ContentBlock): Promise<void>;
  seal(metadata: ContentMetadata): Promise<void>;
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
  constructor(
    private readonly recorder: JournalArrivalRecorder,
    private readonly row: ArrivalRow,
    private readonly content: IContent,
  ) {}
  private async end(): Promise<void> {
    if (this.current === undefined) return;
    await this.recorder.endBlock(this.current.block);
    this.current = undefined;
  }
  async append(block: ContentBlock): Promise<void> {
    if (this.finished) throw new Error('Response arrival is finished');
    if (block.type !== 'text' && block.type !== 'thinking') {
      await this.appendComplete(block);
      return;
    }
    const streamId = block.type === 'thinking' ? block.streamId : undefined;
    if (
      this.current?.type !== block.type ||
      this.current.streamId !== streamId
    ) {
      await this.end();
      this.current = {
        type: block.type,
        streamId,
        block: await this.recorder.beginNamedBlock(
          this.row,
          ROW_BLOCK_TYPE[block.type],
        ),
      };
    }
    if (block.type === 'text')
      await this.recorder.appendText(this.current.block, 'text', block.text);
    else {
      await this.recorder.appendText(
        this.current.block,
        'thought',
        block.thought,
        streamId === undefined ? 'delta' : 'snapshot',
      );
      const fields: ReadonlyArray<
        'signature' | 'sourceField' | 'streamId' | 'encryptedContent'
      > = ['signature', 'sourceField', 'streamId', 'encryptedContent'];
      for (const name of fields) {
        const value = block[name];
        if (typeof value === 'string')
          await this.recorder.appendText(
            this.current.block,
            name,
            value,
            'snapshot',
          );
      }
    }
  }
  private async appendComplete(block: ContentBlock): Promise<void> {
    await this.end();
    const handle = await this.recorder.beginBlock(
      this.row,
      ROW_BLOCK_TYPE[block.type],
    );
    const bytes = new TextEncoder().encode(JSON.stringify(block));
    for (let at = 0; at < bytes.length; at += 65536)
      await this.recorder.appendField(handle, bytes.subarray(at, at + 65536));
    await this.recorder.endBlock(handle);
  }
  async seal(metadata: ContentMetadata): Promise<void> {
    if (this.finished) throw new Error('Response arrival is finished');
    await this.end();
    await this.recorder.sealRow(this.row, {
      ...this.content.metadata,
      ...metadata,
    });
    this.finished = true;
    await this.recorder.close();
  }
  async interrupt(
    outcome: Exclude<ArrivalOutcome, 'completed'> = 'interrupted',
  ): Promise<void> {
    if (this.finished) return;
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
  return new JournalResponseArrival(recorder, row, content);
}
