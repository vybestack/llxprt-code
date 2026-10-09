/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { LogRecord, LogAttributes } from '@opentelemetry/api-logs';
import { flushTelemetry } from './sdk.js';

export interface RequestArtifactDescriptor {
  readonly schema_version: 2;
  readonly artifact_id: string;
  readonly artifact_path: string;
  readonly content_offset: number;
  readonly content_bytes: number;
  readonly content_chars: number;
  readonly content_sha256: string;
  readonly row_count: number;
}

export function artifactAttributes(
  artifact: RequestArtifactDescriptor,
): LogAttributes {
  // Filesystem locations stay local; ID and digest correlate the durable artifact.
  return {
    schema_version: artifact.schema_version,
    artifact_id: artifact.artifact_id,
    content_bytes: artifact.content_bytes,
    content_chars: artifact.content_chars,
    content_sha256: artifact.content_sha256,
    row_count: artifact.row_count,
    content_format: 'json-array-utf8',
    chunk_encoding: 'base64',
  };
}

export async function emitRequestArtifact(
  artifact: RequestArtifactDescriptor,
  attributes: LogAttributes,
  emit: (record: LogRecord) => void | Promise<void>,
  signal?: AbortSignal,
  acknowledged = false,
): Promise<void> {
  const file = await fs.open(artifact.artifact_path, 'r');
  const buffer = Buffer.alloc(16384);
  const hash = createHash('sha256');
  let offset = 0;
  let index = 0;
  const name = attributes['event.name'];
  try {
    if (!acknowledged) await flushTelemetry();
    while (offset < artifact.content_bytes) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, artifact.content_bytes - offset),
        artifact.content_offset + offset,
      );
      if (bytesRead === 0) throw new Error('Truncated request artifact');
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      await emit({
        body: `Telemetry event: ${name}_chunk`,
        attributes: {
          ...attributes,
          ...artifactAttributes(artifact),
          'event.name': `${name}_chunk`,
          chunk_index: index++,
          chunk_byte_offset: offset,
          chunk_data: bytes.toString('base64'),
        },
      });
      offset += bytesRead;
      // Await each export so the SDK queue cannot retain or drop a transcript's chunks.
      if (!acknowledged) await flushTelemetry();
    }
    signal?.throwIfAborted();
    if (hash.digest('hex') !== artifact.content_sha256)
      throw new Error('Request artifact digest mismatch');
    await emit({
      body: `Telemetry event: ${name}_complete`,
      attributes: {
        ...attributes,
        ...artifactAttributes(artifact),
        'event.name': `${name}_complete`,
        chunk_count: index,
        content_complete: true,
      },
    });
    if (!acknowledged) await flushTelemetry();
  } finally {
    await file.close();
  }
}
