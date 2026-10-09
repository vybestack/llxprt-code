/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { EVENT_API_REQUEST } from './constants.js';
import { RequestArtifactReceiver } from './request-artifact-receiver.js';

function boundedLine(text: string): string {
  if (text.length > 65536)
    throw new Error('Artifact reader requires bounded chunk protocol records');
  return text;
}

async function* lines(
  path: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const file = await open(path, 'r');
  const buffer = Buffer.alloc(16384);
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let bytesRead = 1;
  try {
    while (bytesRead !== 0) {
      signal?.throwIfAborted();
      bytesRead = (await file.read(buffer)).bytesRead;
      const text =
        bytesRead === 0
          ? decoder.end()
          : decoder.write(buffer.subarray(0, bytesRead));
      let offset = 0;
      for (
        let end = text.indexOf('\n');
        end !== -1;
        end = text.indexOf('\n', offset)
      ) {
        yield boundedLine(pending + text.slice(offset, end));
        pending = '';
        offset = end + 1;
      }
      pending = boundedLine(pending + text.slice(offset));
    }
    if (pending !== '') throw new Error('Truncated artifact telemetry record');
  } finally {
    await file.close();
  }
}

const record = z.object({ attributes: z.record(z.unknown()).optional() });

/** Yielded bytes are provisional until iteration finishes with verified completion. */
export async function* readRequestArtifact(
  path: string,
  publicationId: string,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const receiver = new RequestArtifactReceiver();
  let completed = false;
  for await (const line of lines(path, signal)) {
    const fields = record.parse(JSON.parse(line)).attributes;
    if (fields?.publication_id !== publicationId) continue;
    if (fields.schema_version !== 4)
      throw new Error('Artifact reader requires schema 4');
    if (fields['event.name'] === `${EVENT_API_REQUEST}_abort`)
      throw new Error('Aborted request artifact publication');
    const bytes = receiver.accept(fields);
    if (bytes !== undefined) yield bytes;
    if (fields['event.name'] === `${EVENT_API_REQUEST}_complete`)
      completed = true;
  }
  signal?.throwIfAborted();
  receiver.assertComplete();
  if (!completed) throw new Error('Missing request artifact completion');
}
