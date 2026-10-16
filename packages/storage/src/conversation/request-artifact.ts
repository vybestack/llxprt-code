/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import { join } from 'node:path';

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

export async function stageRequestArtifact(
  directory: string,
  provider: string,
  messages: AsyncIterable<unknown>,
  context?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<RequestArtifactDescriptor> {
  signal?.throwIfAborted();
  const artifactId = randomUUID();
  const artifactPath = join(directory, `request-${artifactId}.jsonl`);
  const temporary = join(directory, `.request-${artifactId}`);
  const file = await fs.open(temporary, 'wx', 0o600);
  const hash = createHash('sha256');
  let contentBytes = 0;
  let contentChars = 0;
  let rowCount = 0;
  const writeContent = async (text: string): Promise<void> => {
    signal?.throwIfAborted();
    hash.update(text);
    contentBytes += Buffer.byteLength(text);
    contentChars += text.length;
    await file.writeFile(text);
  };
  try {
    const header = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'request',
      provider,
    });
    const prefix = header.slice(0, -1) + ',"messages":';
    await file.writeFile(prefix);
    await writeContent('[');
    for await (const row of messages) {
      await writeContent((rowCount === 0 ? '' : ',') + JSON.stringify(row));
      rowCount++;
    }
    await writeContent(']');
    await file.writeFile(
      (context === undefined ? '' : ',"context":' + JSON.stringify(context)) +
        '}\n',
    );
    signal?.throwIfAborted();
    await file.sync();
    await file.close();
    await fs.rename(temporary, artifactPath);
    return {
      schema_version: 2,
      artifact_id: artifactId,
      artifact_path: artifactPath,
      content_offset: Buffer.byteLength(prefix),
      content_bytes: contentBytes,
      content_chars: contentChars,
      content_sha256: hash.digest('hex'),
      row_count: rowCount,
    };
  } catch (error) {
    await file.close();
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function appendArtifact(
  artifact: RequestArtifactDescriptor,
  targetPath: string,
): Promise<void> {
  const target = await fs.open(targetPath, 'a', 0o600);
  try {
    for await (const chunk of createReadStream(artifact.artifact_path, {
      highWaterMark: 16384,
    }))
      await target.writeFile(chunk);
  } finally {
    await target.close();
  }
}
