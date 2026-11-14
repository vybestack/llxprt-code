/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { BlockPosition } from '../../journal/idFactCodec.js';
import type { RowIds } from '../../journal/rowReads.js';
import type { ContentBlock, IContent } from './IContent.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import {
  responseBlockAt,
  responsePartAt,
  type ResponsePart,
} from './journal-response-parts.js';
import type { JournalResponseSource } from './journal-response-source.js';
import { ROW_BLOCK_TYPE } from '../../journal/rowRecord.js';
import { streamBlockField } from './stream-block-field.js';
import { serializeRequestRow } from './token-usage-measurement.js';

export interface CountingBlock {
  readonly content: ContentBlock;
  readonly text: AsyncIterable<Uint8Array>;
}

export interface JournalBlockReference {
  readonly at: BlockPosition;
  readonly kind: 'source' | 'response' | 'orphan' | 'reconstructed';
  readonly id?: string;
}

export interface JournalResponsePlan {
  readonly header: IContent;
  readonly blocks: readonly JournalBlockReference[];
  readonly pending: boolean;
  sourceIds?(label: bigint): RowIds | undefined;
  openBlocks(): AsyncGenerator<ContentBlock>;
  openCountingBlocks?(): AsyncGenerator<CountingBlock>;
}

async function resolveBlock(
  source: JournalResponseSource,
  ref: JournalBlockReference,
  known?: ResponsePart,
): Promise<ContentBlock> {
  const block = await responseBlockAt(source, ref.at, known);
  if (ref.kind === 'source') return block;
  if (ref.kind === 'response') {
    if (block.type !== 'tool_response' || block.callId !== ref.id)
      throw new JournalFormatError(
        'Response fact does not point to its response',
      );
    return block;
  }
  if (ref.kind === 'orphan') {
    if (block.type !== 'tool_call' || block.id !== ref.id)
      throw new JournalFormatError('Orphan fact does not point to its call');
    return {
      type: 'tool_response',
      callId: block.id,
      toolName: block.name || 'unknown_tool',
      result: null,
      error: 'Tool call interrupted or cancelled',
      isComplete: true,
    };
  }
  if (block.type !== 'tool_response' || block.callId !== ref.id)
    throw new JournalFormatError('Reconstruction source is not its response');
  return {
    type: 'tool_call',
    id: block.callId,
    name: block.toolName || 'unknown_tool',
    parameters: { reconstructed: true },
    description: 'Reconstructed tool call after compression',
  };
}

function textProjection(
  type: number,
): { readonly content: ContentBlock; readonly field: string } | undefined {
  switch (type) {
    case ROW_BLOCK_TYPE.text:
      return { content: { type: 'text', text: '' }, field: 'text' };
    case ROW_BLOCK_TYPE.thinking:
      return { content: { type: 'thinking', thought: '' }, field: 'thought' };
    case ROW_BLOCK_TYPE.code:
      return { content: { type: 'code', code: '' }, field: 'code' };
    default:
      return undefined;
  }
}

async function countingBlock(
  source: JournalResponseSource,
  ref: JournalBlockReference,
  known?: ResponsePart,
): Promise<CountingBlock> {
  if (ref.kind !== 'source' || source.blocks === undefined)
    return materializedCountingBlock(await resolveBlock(source, ref, known));
  const part = await responsePartAt(source, ref.at, known);
  const index = part.indices[ref.at.block];
  const projection = textProjection(part.ids.header.blocks[index].type);
  if (projection === undefined)
    return materializedCountingBlock(await resolveBlock(source, ref, known));
  for await (const block of source.blocks(part.entry)) {
    if (block.ordinal === index)
      return {
        content: projection.content,
        text: streamBlockField(block, projection.field),
      };
  }
  throw new JournalFormatError('Counting source block is absent');
}

function materializedCountingBlock(content: ContentBlock): CountingBlock {
  return {
    content,
    text: (async function* () {
      const bytes = Buffer.from(
        serializeRequestRow({ speaker: 'ai', blocks: [content] }),
      );
      for (let offset = 0; offset < bytes.length; offset += 65536)
        yield bytes.subarray(offset, offset + 65536);
    })(),
  };
}

export function responsePlan(
  source: JournalResponseSource,
  header: IContent,
  blocks: readonly JournalBlockReference[],
  pending: boolean,
  known?: ResponsePart,
): JournalResponsePlan {
  return {
    header: sanitizeProviderContentForSerialization(header),
    blocks,
    pending,
    sourceIds: (label) =>
      known?.entry.label === label ? known.ids : undefined,
    async *openCountingBlocks() {
      for (const ref of blocks) yield await countingBlock(source, ref, known);
    },
    async *openBlocks() {
      for (const ref of blocks) {
        const block = await resolveBlock(source, ref, known);
        // Decoding owns this block; journal admission already sanitized its JSON.
        yield block;
      }
    },
  };
}
