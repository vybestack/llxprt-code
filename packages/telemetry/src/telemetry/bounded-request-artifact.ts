/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { logs, type LogAttributes } from '@opentelemetry/api-logs';
import type { TelemetryConfig } from '../internal/interfaces.js';
import type { RequestArtifactDescriptor } from './request-artifact.js';
import { SERVICE_NAME, EVENT_API_REQUEST } from './constants.js';
import {
  assertRequestArtifactExporter,
  flushRequestArtifactTelemetry,
  isTelemetrySdkInitialized,
} from './sdk.js';
import {
  requestTextChunks,
  requestTextDimensions,
} from './request-text-chunks.js';

export interface RuntimeRequestArtifact {
  readonly schema_version: 3;
  readonly serialization:
    | 'independent-safe-json-rows-v1'
    | 'legacy-request-text-v1';
  readonly source: RequestArtifactDescriptor;
}

function validate(artifact: RuntimeRequestArtifact): void {
  const schema: unknown = artifact.schema_version;
  const sourceSchema: unknown = artifact.source.schema_version;
  if (
    schema !== 3 ||
    sourceSchema !== 2 ||
    !['independent-safe-json-rows-v1', 'legacy-request-text-v1'].includes(
      artifact.serialization,
    )
  ) {
    throw new Error('Unsupported runtime request artifact schema');
  }
  const source = artifact.source;
  for (const value of [
    source.content_offset,
    source.content_bytes,
    source.content_chars,
    source.row_count,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid request artifact dimensions');
  }
  if (!/^[a-f0-9]{64}$/.test(source.content_sha256))
    throw new Error('Invalid request artifact digest');
}

async function abortPublication(
  attributes: LogAttributes,
  publicationId: string,
): Promise<void> {
  await flushRequestArtifactTelemetry({
    body: `Telemetry event: ${EVENT_API_REQUEST}_abort`,
    attributes: {
      ...attributes,
      'event.name': `${EVENT_API_REQUEST}_abort`,
      schema_version: 4,
      publication_id: publicationId,
    },
  });
}

async function publish(
  attributes: LogAttributes,
  artifact: RuntimeRequestArtifact,
  cap: number,
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  const file = await fs.open(artifact.source.artifact_path, 'r');
  const publicationId = randomUUID();
  const emit = async (name: string, fields: LogAttributes): Promise<void> => {
    signal?.throwIfAborted();
    await flushRequestArtifactTelemetry({
      body:
        name === EVENT_API_REQUEST
          ? `API request to ${model}.`
          : `Telemetry event: ${name}`,
      attributes: {
        ...attributes,
        ...fields,
        'event.name': name,
        publication_id: publicationId,
      },
    });
  };
  let started = false;
  try {
    const dimensions = await requestTextDimensions(
      file,
      artifact.source,
      cap,
      signal,
    );
    const visibleChars = Math.min(cap, artifact.source.content_chars);
    const fields: LogAttributes = {
      schema_version: 4,
      request_text_protocol: 'json-string-chunks-v1',
      serialization: artifact.serialization,
      artifact_id: artifact.source.artifact_id,
      content_bytes: artifact.source.content_bytes,
      content_chars: artifact.source.content_chars,
      content_sha256: artifact.source.content_sha256,
      row_count: artifact.source.row_count,
      ...dimensions,
      visible_chars: visibleChars,
      truncated: visibleChars < artifact.source.content_chars,
      content_format: 'capped-request-text-json-string-utf8',
      chunk_encoding: 'base64',
    };
    signal?.throwIfAborted();
    started = true;
    await emit(EVENT_API_REQUEST, fields);
    let index = 0;
    let offset = 0;
    for await (const chunk of requestTextChunks(
      file,
      artifact.source,
      cap,
      signal,
    )) {
      await emit(`${EVENT_API_REQUEST}_chunk`, {
        ...fields,
        chunk_index: index++,
        chunk_byte_offset: offset,
        chunk_data: chunk.toString('base64'),
      });
      offset += chunk.length;
    }
    await emit(`${EVENT_API_REQUEST}_complete`, {
      ...fields,
      chunk_count: index,
      content_complete: true,
    });
  } catch (error) {
    if (started) await abortPublication(attributes, publicationId);
    throw error;
  } finally {
    await file.close();
  }
}

export async function logBoundedRequestArtifact(
  config: TelemetryConfig,
  model: string,
  promptId: string,
  artifact: RuntimeRequestArtifact,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  validate(artifact);
  if (!isTelemetrySdkInitialized())
    throw new Error(
      'Request artifact logging requires an active telemetry SDK',
    );
  const attributes: LogAttributes = {
    'session.id': config.getSessionId(),
    model,
    prompt_id: promptId,
    'event.name': EVENT_API_REQUEST,
    'event.timestamp': new Date().toISOString(),
    request_chars: artifact.source.content_chars,
  };
  if (
    !config.getTelemetryLogApiBodiesEnabled() ||
    !config.getTelemetryLogPromptsEnabled()
  ) {
    logs
      .getLogger(SERVICE_NAME)
      .emit({ body: `API request to ${model}.`, attributes });
    return;
  }
  assertRequestArtifactExporter();
  const cap = config.getTelemetryLogApiBodyMaxChars();
  if (!Number.isSafeInteger(cap) || cap < 0)
    throw new Error('Invalid request artifact visible cap');
  await publish(attributes, artifact, cap, model, signal);
}
