/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deserialize, serialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ProviderRequestRows,
  ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeTokenizerFactory } from '../../../composition/runtimeTokenizerFactory.js';
import { OpenAIResponsesProvider } from '../../OpenAIResponsesProvider.js';
import type { GenerateChatOptions } from '../../../IProvider.js';

import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

export interface ProjectionDiskFixture {
  readonly root: string;
  readonly rows: ProviderRequestRows;
  readonly state: {
    opened: number;
    pulled: number;
    active: number;
    closed: boolean;
  };
  readonly references: Array<WeakRef<IContent>>;
  readonly retained: IContent[];
  close(): void;
}

export interface ProjectionHttpFixture {
  readonly server: Bun.Server<undefined>;
  readonly bodies: Array<{ bytes: number; sha256: string }>;
  readonly arrived: ReturnType<typeof projectionGate>;
  readonly readBody: ReturnType<typeof projectionGate>;
  readonly uploaded: ReturnType<typeof projectionGate>;
  readonly respond: ReturnType<typeof projectionGate>;
}

export interface ProjectionRuntime {
  readonly config: Config;
  readonly provider: OpenAIResponsesProvider;
  readonly factory: RuntimeTokenizerFactory;
  /** A selection (rows with a close owner) is sent as neutral requestRows; plain rows use the stream path. */
  readonly options: (
    rows: ProviderRequestRows | ProviderRequestSelection,
    signal?: AbortSignal,
  ) => GenerateChatOptions;
}

export const projectionModel = 'gpt-5.6';
export const projectionInstructions =
  'Read rows. Preserve "quotes", \\ and 雪.';
export const rowCount = 64;

export function projectionRowText(index: number, large: boolean): string {
  const unit = `${index}: alpha beta gamma ";\\ 雪\n`;
  const target = large ? 10 * 1024 * 1024 + 4096 : 96 * 1024;
  return unit.repeat(Math.ceil(target / unit.length));
}

export function projectionDiskRows(
  large: boolean,
  retain: boolean,
): ProjectionDiskFixture {
  const root = mkdtempSync(join(tmpdir(), 'actual-projection-'));
  const references: Array<WeakRef<IContent>> = [];
  const retained: IContent[] = [];
  const state = { opened: 0, pulled: 0, active: 0, closed: false };
  for (let index = 0; index < rowCount; index++) {
    writeFileSync(
      join(root, `${index}.row`),
      serialize({
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: projectionRowText(index, large && index === 63),
          },
        ],
      }),
    );
  }
  const rows: ProviderRequestRows = {
    count: rowCount,
    async *openReader(signal?: AbortSignal): AsyncGenerator<IContent, void> {
      state.opened++;
      state.active++;
      try {
        for (let index = 0; index < rowCount; index++) {
          signal?.throwIfAborted();
          if (state.closed) throw new Error('Disk source is closed');
          const row: IContent = deserialize(
            readFileSync(join(root, `${index}.row`)),
          );
          references.push(new WeakRef(row));
          if (retain) retained.push(row);
          state.pulled++;
          yield row;
        }
      } finally {
        state.active--;
      }
    },
  };
  return {
    root,
    rows,
    state,
    references,
    retained,
    close(): void {
      state.closed = true;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function projectionGate(): { wait: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release: () => release() };
}

export function projectionEndpoint(retry: boolean): ProjectionHttpFixture {
  const arrived = projectionGate();
  const readBody = projectionGate();
  const uploaded = projectionGate();
  const respond = projectionGate();
  const bodies: Array<{ bytes: number; sha256: string }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      arrived.release();
      await readBody.wait;
      if (request.body === null) throw new Error('Missing actual HTTP body');
      const hash = createHash('sha256');
      const reader = request.body.getReader();
      let bytes = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          hash.update(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      bodies.push({ bytes, sha256: hash.digest('hex') });
      uploaded.release();
      await respond.wait;
      if (retry && bodies.length === 1)
        return new Response('{"error":{"message":"retry"}}', { status: 503 });
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_projection","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, bodies, arrived, readBody, uploaded, respond };
}

export function projectionWireOracle(large: boolean): {
  bytes: number;
  sha256: string;
} {
  const hash = createHash('sha256');
  let bytes = 0;
  const append = (text: string): void => {
    bytes += Buffer.byteLength(text);
    hash.update(text);
  };
  append(`{"model":"${projectionModel}","input":[`);
  for (let index = 0; index < rowCount; index++) {
    if (index !== 0) append(',');
    append(
      JSON.stringify({
        role: 'user',
        content: projectionRowText(index, large && index === 63),
      }),
    );
  }
  append(
    `],"stream":true,"instructions":${JSON.stringify(projectionInstructions)}}`,
  );
  return { bytes, sha256: hash.digest('hex') };
}

export async function projectionRuntime(
  baseURL: string,
  root: string,
): Promise<ProjectionRuntime> {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', projectionModel);
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model: projectionModel,
    debugMode: false,
    settingsService: settings,
  });
  const factory = createRuntimeTokenizerFactory();
  await factory.prepareTokenizer?.('openai-responses', projectionModel);
  config.setTokenizerFactory(factory);
  const provider = new OpenAIResponsesProvider('test-key', baseURL);
  const runtime = {
    config,
    settingsService: settings,
    runtimeId: randomUUID(),
  };
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: { 'prompt-caching': 'off', retries: 2, retrywait: 0 },
  });
  const options = (
    rows: ProviderRequestRows | ProviderRequestSelection,
    signal?: AbortSignal,
  ): GenerateChatOptions => ({
    contents: { [Symbol.asyncIterator]: () => rows.openReader(signal) },
    ...('close' in rows ? { requestRows: rows } : {}),
    contentCount: rows.count,
    config,
    runtime,
    settings,
    invocation,
    systemInstruction: projectionInstructions,
    metadata: {
      abortSignal: signal,
      _retryRequestContext: { requestId: 'actual-projection' },
    },
  });
  return { config, provider, factory, options };
}
