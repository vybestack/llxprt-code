/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'bun:test';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { BoundarySnapshotDisk } from '../../boundary-snapshot-disk.js';
import type { PromptEnvelopeSource } from '../../promptEnvelopeSendSeam.js';

export function sourceRootSetup(): () => string {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'source-seam-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return () => root;
}

export function rowText(index: number, large = false): string {
  return `${index}:"\\\n雪${large ? 'z'.repeat(10 * 1024 * 1024 + 1) : ''}`;
}

export async function diskSource(root: string, count = 64, large = false) {
  const disk = new BoundarySnapshotDisk(root);
  await disk.capture('after', {
    count,
    async *openReader(): AsyncGenerator<IContent> {
      for (let index = 0; index < count; index++)
        yield {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: rowText(index, large && index === count - 1),
            },
          ],
        };
    },
  });
  const rows = disk.selection('after');
  const references: Array<WeakRef<IContent>> = [];
  const retained: IContent[] = [];
  const state = { closed: 0, opened: 0, pulled: 0, active: 0 };
  const source: PromptEnvelopeSource = {
    count: rows.count,
    async *openReader(
      signal?: AbortSignal,
    ): AsyncGenerator<IContent, void, unknown> {
      state.opened++;
      state.active++;
      try {
        for await (const row of rows.openReader(signal)) {
          references.push(new WeakRef(row));
          if (process.env.ISSUE854_RETAIN_SOURCE_SEAM === '1')
            retained.push(row);
          state.pulled++;
          yield row;
        }
      } finally {
        state.active--;
      }
    },
    close(): void {
      state.closed++;
      disk.close();
    },
  };
  return { source, state, references, retained };
}

export async function digest(rows: ProviderRequestRows): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows.openReader()) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

export function lifecycleProvider() {
  const events: Array<{ token: object; released: number; digest: string }> = [];
  const provider: RuntimeProvider = {
    name: 'source-lifecycle',
    async getModels() {
      return [];
    },
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
    },
    async projectPromptEnvelope(
      options: RuntimeGenerateChatOptions,
    ): Promise<PromptEnvelopeProjection> {
      const hash = createHash('sha256');
      let tokens = 0;
      for await (const row of options.contents) {
        const serialized = JSON.stringify(row);
        hash.update(serialized);
        tokens += serialized.length;
      }
      const event = {
        token: Object.freeze({}),
        released: 0,
        digest: hash.digest('hex'),
      };
      events.push(event);
      return {
        model: 'test-model',
        protocol: 'anthropic-messages',
        method: 'messages/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: event.token,
        finalizedProjection: null,
        legacyEstimate: async () => tokens,
        releaseIfUnsent: async () => {
          event.released++;
        },
      };
    },
  };
  const runtime = createChatSessionRuntime({ provider });
  const buildOptions = (source: PromptEnvelopeSource) => ({
    contents: { [Symbol.asyncIterator]: () => source.openReader() },
    requestRows: source,
    contentCount: source.count,
    config: runtime.config,
  });
  return { provider, events, buildOptions };
}
