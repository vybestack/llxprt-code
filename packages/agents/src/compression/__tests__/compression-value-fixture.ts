/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { JournalResolver } from '@vybestack/llxprt-code-core/recording/journalResolver.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import {
  MiddleoutDiskHistory,
  SummaryTransport,
} from './middleout-disk-helpers.js';

export class ValueCompressionHistory extends MiddleoutDiskHistory {
  get compressionLocked(): boolean {
    return this.isCompressing;
  }
  override transformRows(): Promise<void> {
    throw new Error('Disk compression must select detached value publication');
  }
}

export class StreamingSummaryTransport extends SummaryTransport {
  override async *generateChatCompletion(
    options: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    if (!('contents' in options)) throw new Error('Expected chat options');
    for await (const _row of options.contents) {
      void _row;
    }
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: '<state_snapshot>retained facts</state_snapshot>',
        },
      ],
    };
  }
}

export function valueGate(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {
    throw new Error('Uninitialized value gate');
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function compressionValueDigest(
  rows: AsyncIterable<IContent>,
): Promise<{ count: number; bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let count = 0;
  let bytes = 0;
  for await (const row of rows) {
    const value = JSON.stringify(
      row,
      (_key: string, value: unknown): unknown =>
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            )
          : value,
    );
    hash.update(value + '\n');
    bytes += Buffer.byteLength(value);
    count++;
  }
  return { count, bytes, sha256: hash.digest('hex') };
}

export async function compressionDurableValueDigest(
  recorder: SessionRecordingService,
): Promise<Awaited<ReturnType<typeof compressionValueDigest>>> {
  const path = recorder.getFilePath();
  if (path === null) throw new Error('Missing durable journal');
  const resolver = await JournalResolver.open(path);
  try {
    async function* rows(): AsyncGenerator<IContent, void, unknown> {
      for await (const entry of resolver.resolve()) yield entry.content;
    }
    return await compressionValueDigest(rows());
  } finally {
    await resolver.close();
  }
}
