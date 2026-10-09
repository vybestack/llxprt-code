/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ApiRequestEvent } from '@vybestack/llxprt-code-telemetry/telemetry/types.js';
import { TurnRequestBoundaryIdentity } from './turn-request-json.js';

type RequestArtifactDescriptor = NonNullable<
  ApiRequestEvent['request_artifact']
>;

/** Stages disk rows with the one normalization-owned boundary identity only. */
export async function stageTurnRequestArtifact(
  directory: string,
  contents: AsyncIterable<IContent>,
  signal?: AbortSignal,
): Promise<RequestArtifactDescriptor> {
  signal?.throwIfAborted();
  const id = randomUUID();
  const temporary = join(directory, `.turn-request-${id}`);
  const target = join(directory, `turn-request-${id}.json`);
  const file = await fs.open(temporary, 'wx', 0o600);
  const hash = createHash('sha256');
  const identity = new TurnRequestBoundaryIdentity();
  let bytes = 0;
  let chars = 0;
  let count = 0;
  const write = async (text: string): Promise<void> => {
    signal?.throwIfAborted();
    hash.update(text);
    bytes += Buffer.byteLength(text);
    chars += text.length;
    await file.writeFile(text);
  };
  let closed = false;
  try {
    await write('[');
    for await (const row of contents) {
      signal?.throwIfAborted();
      if (count > 0) await write(',');
      for (const chunk of identity.row(row, count)) await write(chunk);
      count++;
    }
    await write(']');
    await file.sync();
    await file.close();
    closed = true;
    signal?.throwIfAborted();
    await fs.rename(temporary, target);
    return {
      schema_version: 2,
      artifact_id: id,
      artifact_path: target,
      content_offset: 0,
      content_bytes: bytes,
      content_chars: chars,
      content_sha256: hash.digest('hex'),
      row_count: count,
    };
  } catch (error) {
    try {
      if (!closed) await file.close();
    } finally {
      await fs.rm(temporary, { force: true });
    }
    throw error;
  }
}
