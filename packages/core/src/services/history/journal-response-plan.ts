/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { BlockPosition } from '../../journal/idFactCodec.js';
import type { ContentBlock, IContent } from './IContent.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import {
  responseBlockAt,
  type ResponsePart,
} from './journal-response-parts.js';
import type { JournalResponseSource } from './journal-response-source.js';

export interface JournalBlockReference {
  readonly at: BlockPosition;
  readonly kind: 'source' | 'response' | 'orphan' | 'reconstructed';
  readonly id?: string;
}

export interface JournalResponsePlan {
  readonly header: IContent;
  readonly blocks: readonly JournalBlockReference[];
  readonly pending: boolean;
  openBlocks(): AsyncGenerator<ContentBlock>;
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
    async *openBlocks() {
      for (const ref of blocks) {
        const block = await resolveBlock(source, ref, known);
        yield sanitizeProviderContentForSerialization({
          speaker: header.speaker,
          blocks: [block],
        }).blocks[0];
      }
    },
  };
}
