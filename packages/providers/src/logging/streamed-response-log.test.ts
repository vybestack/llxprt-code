/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';

describe('streamed response conversation file', () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await fs.rm(directory, { recursive: true, force: true });
  });
  it('writes escaped response pieces before completion and publishes the same JSONL entry', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'llxprt-response-'));
    directories.push(directory);
    const writer = new ConversationFileWriter(directory);
    const stream = await writer.openResponseStream('provider');
    const text = 'hello "world"\nbackslash \\ emoji 🙂';
    for (let offset = 0; offset < text.length; offset++)
      await stream.append(text[offset] ?? '');
    const growing = await fs.readFile(stream.artifactPath, 'utf8');
    expect(growing.length).toBeGreaterThan(text.length);
    expect(growing).toContain('hello \\"world\\"');
    const artifact = await stream.finish({ duration: 12, success: true });
    const lines = await fs.readFile(
      join(
        directory,
        `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
      ),
      'utf8',
    );
    const entry: unknown = JSON.parse(lines);
    expect(entry).toMatchObject({
      type: 'response',
      provider: 'provider',
      response: text,
      metadata: { duration: 12, success: true },
    });
    expect(await fs.readFile(artifact.artifact_path, 'utf8')).toBe(lines);
    const expectedBody = JSON.stringify(text);
    expect(artifact.content_bytes).toBe(Buffer.byteLength(expectedBody));
    expect(
      lines.slice(
        artifact.content_offset,
        artifact.content_offset + artifact.content_chars,
      ),
    ).toBe(expectedBody);
  });

  it('serializes concurrent response completions without mixing their bodies', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'llxprt-response-'));
    directories.push(directory);
    const writer = new ConversationFileWriter(directory);
    const first = await writer.openResponseStream('one');
    const second = await writer.openResponseStream('two');
    await first.append('aaa');
    await second.append('bbb');
    await Promise.all([
      second.finish({ success: true }),
      first.finish({ success: true }),
    ]);
    const log = await fs.readFile(
      join(
        directory,
        `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
      ),
      'utf8',
    );
    expect(
      log
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line)),
    ).toMatchObject([
      { provider: 'two', response: 'bbb' },
      { provider: 'one', response: 'aaa' },
    ]);
  });
});
