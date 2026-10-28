/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import { MetadataJsonProjection } from '../recording/metadataJsonProjection.js';
import type { DraftId } from './rowDraft.js';
import type { RecordAccess } from './recordAccess.js';
import { ROW_BLOCK_TYPE, ROW_ID_KIND } from './rowRecord.js';
import { transcriptEntries } from './transcript-tree.js';
import {
  chunkValue,
  decodeChunkBlock,
  chunkFieldParts,
  chunkBlockParts,
  type ChunkBlock,
  type ChunkManifest,
} from './chunk-row.js';
import { fieldCode, type ArrivalFieldName } from './chunk-fields.js';
import { JournalFormatError } from './errors.js';

async function textField(
  access: RecordAccess,
  manifest: ChunkManifest,
  ordinal: number,
  block: ChunkBlock,
  name: ArrivalFieldName,
): Promise<string> {
  const code = fieldCode(name);
  const found = await transcriptEntries(
    access,
    block.piecesRoot,
    'blocks',
    BigInt(code),
    false,
  ).next();
  if (found.value?.transcriptId !== BigInt(code))
    throw new JournalFormatError(`Missing ${name} field`);
  const field = decodeChunkBlock(await chunkValue(access, found.value.rowRef));
  const bytes = new Uint8Array(field.length);
  let at = 0;
  for await (const part of chunkFieldParts(
    access,
    manifest,
    ordinal,
    field,
    code,
  )) {
    bytes.set(part, at);
    at += part.length;
  }
  const value: unknown = JSON.parse(
    `"${new TextDecoder('utf-8', { fatal: true }).decode(bytes)}"`,
  );
  if (typeof value !== 'string')
    throw new JournalFormatError('Invalid named text field');
  return value;
}

async function completeBlockId(
  access: RecordAccess,
  manifest: ChunkManifest,
  ordinal: number,
  type: number,
): Promise<DraftId> {
  let hasResult = false;
  const fields = new Set([
    'id',
    'name',
    'callId',
    'toolName',
    'error',
    'isComplete',
  ]);
  const parser = new MetadataJsonProjection({
    retain: (path) =>
      path.length === 0 || (path.length === 1 && fields.has(String(path[0]))),
    begin: (path) => {
      if (path.length === 1 && path[0] === 'result') hasResult = true;
    },
    scalar: (path, value) => {
      if (path.length === 1 && path[0] === 'result') hasResult = value !== null;
      return true;
    },
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const part of chunkBlockParts(access, manifest, ordinal))
    parser.push(decoder.decode(part, { stream: true }));
  parser.push(decoder.decode());
  const value = parser.finish();
  if (type === ROW_BLOCK_TYPE.tool_call) {
    const call = z.object({ id: z.string(), name: z.string() }).parse(value);
    return {
      rawId: call.id,
      kind: ROW_ID_KIND.call,
      block: ordinal,
      score: 0,
      nameLen: Buffer.byteLength(call.name),
    };
  }
  const response = z
    .object({
      callId: z.string(),
      toolName: z.string(),
      error: z.string().optional(),
      isComplete: z.boolean().optional(),
    })
    .parse(value);
  return {
    rawId: response.callId,
    kind: ROW_ID_KIND.response,
    block: ordinal,
    score:
      (response.isComplete === true ? 2 : 0) -
      (response.error ? 1 : 0) +
      Number(hasResult) +
      1,
    nameLen: Buffer.byteLength(response.toolName),
  };
}

/** Id facts do not retain argument or result payloads. */
export async function* chunkIds(
  access: RecordAccess,
  manifest: ChunkManifest,
): AsyncGenerator<DraftId> {
  let ordinal = 0;
  for await (const entry of transcriptEntries(
    access,
    manifest.blocksRoot,
    'blocks',
    0n,
    false,
  )) {
    const block = decodeChunkBlock(await chunkValue(access, entry.rowRef));
    const index = ordinal++;
    if (
      block.type !== ROW_BLOCK_TYPE.tool_call &&
      block.type !== ROW_BLOCK_TYPE.tool_response
    )
      continue;
    if (block.named !== true) {
      yield await completeBlockId(access, manifest, index, block.type);
    } else {
      const sourceIndex = entry.label === 0n ? index : Number(entry.label - 1n);
      const rawId = await textField(access, manifest, sourceIndex, block, 'id');
      const name = await textField(
        access,
        manifest,
        sourceIndex,
        block,
        'name',
      );
      yield {
        rawId,
        kind: ROW_ID_KIND.call,
        block: index,
        score: 0,
        nameLen: Buffer.byteLength(name),
      };
    }
  }
}
