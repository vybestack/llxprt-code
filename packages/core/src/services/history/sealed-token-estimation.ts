/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { DirectoryBlock } from '../../journal/row-directory.js';
import { ROW_BLOCK_TYPE } from '../../journal/rowRecord.js';
import type { DebugLogger } from '../../debug/DebugLogger.js';
import { decodeStoredBlock, decodeStoredRow } from './journalRowCodec.js';
import {
  estimateContentTokens,
  type TokenizerProvider,
} from './historyTokenEstimation.js';
import { streamBlockField } from './stream-block-field.js';
import { sealedMediaImageTokens } from './sealed-media-estimation.js';
import { countSimpleTextStream } from '../../utils/simple-text-stream.js';

async function* toolCallText(
  block: DirectoryBlock,
): AsyncGenerator<Uint8Array> {
  yield Buffer.from('{"name":');
  yield* streamBlockField(block, 'name', true);
  const parameters = streamBlockField(block, 'parameters', true);
  const first = await parameters.next();
  if (first.done !== true) {
    yield Buffer.from(',"parameters":');
    yield first.value;
    yield* parameters;
  }
  yield Buffer.from('}');
}
async function* toolResponseText(
  block: DirectoryBlock,
): AsyncGenerator<Uint8Array> {
  let errorBytes = 0;
  for await (const part of streamBlockField(block, 'error')) {
    errorBytes += part.byteLength;
    yield part;
  }
  const result = streamBlockField(block, 'result');
  const first = await result.next();
  if (first.done !== true) {
    if (errorBytes > 0) yield Uint8Array.of(10);
    yield first.value;
    yield* result;
  }
}
function streamedBlock(
  block: DirectoryBlock,
): AsyncIterable<Uint8Array> | undefined {
  switch (block.type) {
    case ROW_BLOCK_TYPE.text:
      return streamBlockField(block, 'text');
    case ROW_BLOCK_TYPE.thinking:
      return streamBlockField(block, 'thought');
    case ROW_BLOCK_TYPE.code:
      return streamBlockField(block, 'code');
    case ROW_BLOCK_TYPE.tool_call:
      return block.normalizedJson === true ? toolCallText(block) : undefined;
    case ROW_BLOCK_TYPE.tool_response:
      return block.normalizedJson === true
        ? toolResponseText(block)
        : undefined;
    case ROW_BLOCK_TYPE.media:
      return streamBlockField(block, 'caption');
    default:
      return undefined;
  }
}
async function countStreamedBlock(
  block: DirectoryBlock,
  parts: AsyncIterable<Uint8Array>,
  count: (parts: AsyncIterable<Uint8Array>) => Promise<number>,
  fallbackPolicy: 'allow' | 'deny' | undefined,
  logger: DebugLogger,
): Promise<number> {
  try {
    return await count(parts);
  } catch (error) {
    if (fallbackPolicy === 'deny') throw error;
    logger.debug(
      'Error counting streamed tokens for block, using fallback:',
      error,
    );
    const fallback = streamedBlock(block);
    if (fallback === undefined) throw error;
    return countSimpleTextStream(fallback);
  }
}

export async function estimateSealedTokens(
  snapshot: VersionSnapshot,
  entry: RowEntry,
  model: string,
  provider: TokenizerProvider,
  logger: DebugLogger,
): Promise<number> {
  const tokenizer = provider.getTokenizerForModel(model);
  if (tokenizer.countTokenStream === undefined)
    return estimateContentTokens(
      decodeStoredRow(await snapshot.readRow(entry)),
      model,
      provider,
      logger,
    );
  let total = 0;
  for await (const block of snapshot.blocks(entry)) {
    let parts = streamedBlock(block);
    if (block.type === ROW_BLOCK_TYPE.media) {
      const images = await sealedMediaImageTokens(
        block,
        provider.activeProvider,
        model,
      );
      if (images !== undefined) total += images;
      else parts = undefined;
    }
    if (parts !== undefined) {
      total += await countStreamedBlock(
        block,
        parts,
        tokenizer.countTokenStream.bind(tokenizer),
        tokenizer.fallbackPolicy,
        logger,
      );
    } else {
      const content = {
        speaker: 'ai',
        blocks: [
          decodeStoredBlock(
            await snapshot.readBlock(entry, block.ordinal),
            block.type,
          ),
        ],
      } satisfies Parameters<typeof estimateContentTokens>[0];
      total += await estimateContentTokens(content, model, provider, logger);
    }
  }
  return total;
}
