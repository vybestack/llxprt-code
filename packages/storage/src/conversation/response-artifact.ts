/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestArtifactDescriptor } from './request-artifact.js';

export class ResponseArtifactStream {
  private readonly hash = createHash('sha256');
  private bytes = 0;
  private chars = 0;
  private trailingSurrogate = '';
  private closed = false;
  private constructor(
    readonly artifactPath: string,
    private readonly artifactId: string,
    private readonly file: FileHandle,
    private readonly prefix: string,
    private readonly publish: (
      complete: () => Promise<RequestArtifactDescriptor>,
    ) => Promise<RequestArtifactDescriptor>,
  ) {}

  static async open(
    directory: string,
    provider: string,
    publish: (
      complete: () => Promise<RequestArtifactDescriptor>,
    ) => Promise<RequestArtifactDescriptor>,
  ): Promise<ResponseArtifactStream> {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const artifactPath = join(directory, `response-${id}.jsonl`);
    const file = await fs.open(artifactPath, 'wx', 0o600);
    const header = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'response',
      provider,
    });
    const prefix = header.slice(0, -1) + ',"response":';
    const stream = new ResponseArtifactStream(
      artifactPath,
      id,
      file,
      prefix,
      publish,
    );
    try {
      await file.writeFile(prefix);
      await stream.writeContent('"');
      return stream;
    } catch (error) {
      await stream.abort();
      throw error;
    }
  }

  private async writeContent(text: string): Promise<void> {
    this.hash.update(text);
    this.bytes += Buffer.byteLength(text);
    this.chars += text.length;
    await this.file.writeFile(text);
  }

  async append(text: string): Promise<void> {
    if (this.closed) throw new Error('Response artifact is closed');
    let content = this.trailingSurrogate + text;
    const last = content.charCodeAt(content.length - 1);
    const hasTrailingHighSurrogate = last >= 0xd800 && last <= 0xdbff;
    this.trailingSurrogate = hasTrailingHighSurrogate ? content.slice(-1) : '';
    if (hasTrailingHighSurrogate) content = content.slice(0, -1);
    await this.writeContent(JSON.stringify(content).slice(1, -1));
  }

  finish(
    metadata: Record<string, unknown>,
  ): Promise<RequestArtifactDescriptor> {
    return this.publish(() => this.complete(metadata));
  }

  private async complete(
    metadata: Record<string, unknown>,
  ): Promise<RequestArtifactDescriptor> {
    if (this.closed) throw new Error('Response artifact is closed');
    try {
      await this.writeContent(
        JSON.stringify(this.trailingSurrogate).slice(1, -1) + '"',
      );
      this.trailingSurrogate = '';
      await this.file.writeFile(
        ',"metadata":' + JSON.stringify(metadata) + '}\n',
      );
      await this.file.sync();
    } finally {
      this.closed = true;
      await this.file.close();
    }
    const artifact: RequestArtifactDescriptor = {
      schema_version: 2,
      artifact_id: this.artifactId,
      artifact_path: this.artifactPath,
      content_offset: Buffer.byteLength(this.prefix),
      content_bytes: this.bytes,
      content_chars: this.chars,
      content_sha256: this.hash.digest('hex'),
      row_count: 1,
    };
    return artifact;
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.file.close();
      await fs.rm(this.artifactPath, { force: true });
    }
  }
}
