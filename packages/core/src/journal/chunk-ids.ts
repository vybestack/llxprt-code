/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DraftId } from './rowDraft.js';
import type { RecordAccess } from './recordAccess.js';
import { ROW_BLOCK_TYPE, ROW_ID_KIND } from './rowRecord.js';
import { transcriptEntries } from './transcript-tree.js';
import {
  chunkValue,
  decodeChunkBlock,
  chunkFieldParts,
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

/** Id facts are read without reading or parsing argument payloads. */
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
    if (block.named !== true || block.type !== ROW_BLOCK_TYPE.tool_call)
      continue;
    const rawId = await textField(access, manifest, index, block, 'id');
    const name = await textField(access, manifest, index, block, 'name');
    yield {
      rawId,
      kind: ROW_ID_KIND.call,
      block: index,
      score: 0,
      nameLen: Buffer.byteLength(name),
    };
  }
}
