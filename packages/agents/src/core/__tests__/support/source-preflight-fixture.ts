/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { withGpt56DiskSources } from '@vybestack/llxprt-code-providers/tokenizers/gpt56-disk-tokenizer-factory.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { FileLogExporter } from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { prepareAtSendSeam } from '../../promptEnvelopeSendSeam.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { requestSelection } from './request-selection.js';
import { BoundarySnapshotDisk } from '../../boundary-snapshot-disk.js';

export async function preflightDisk(root: string, large: boolean) {
  const disk = new BoundarySnapshotDisk(root);
  await disk.capture('after', {
    count: 64,
    async *openReader(): AsyncGenerator<IContent> {
      for (let index = 0; index < 64; index++) yield diskTextRow(index, large);
    },
  });
  const rows = disk.selection('after');
  const state = { closed: 0, active: 0 };
  const source = requestSelection({
    count: 64,
    async *openReader(signal?: AbortSignal): AsyncGenerator<IContent> {
      state.active++;
      try {
        yield* rows.openReader(signal);
      } finally {
        state.active--;
      }
    },
    close(): void {
      state.closed++;
      disk.close();
    },
  });
  return { source, state };
}

export const preflightInstructions = 'Read rows.';
export function barrier(): { wait: Promise<void>; release(): void } {
  let release = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
export function preflightEndpoint(retry = false) {
  const bodies: Array<{ bytes: number; sha256: string }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      if (request.body === null) throw new Error('Missing upload');
      const hash = createHash('sha256');
      let bytes = 0;
      const reader = request.body.getReader();
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
      if (retry && bodies.length === 1)
        return new Response('{"error":{"message":"retry"}}', { status: 503 });
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_preflight","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { bodies, server };
}
export function preflightRuntime(
  root: string,
  baseURL: string,
  logging = false,
  model = 'gpt-5.6',
) {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', model);
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model,
    debugMode: false,
    settingsService: settings,
    telemetry: {
      enabled: logging,
      logPrompts: logging,
      logApiBodies: logging,
      logApiBodyMaxChars: 32 * 1024 * 1024,
      outfile: join(root, 'preflight.jsonl'),
    },
  });
  config.setTokenizerFactory(
    withGpt56DiskSources(createRuntimeTokenizerFactory(), root),
  );
  const provider = new OpenAIResponsesProvider('test-key', baseURL);
  const context = { config, settingsService: settings, runtimeId: root };
  const invocation = createRuntimeInvocationContext({
    runtime: context,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: { 'prompt-caching': 'off', retries: 1, retrywait: 0 },
  });
  return { config, provider, context, invocation };
}
export async function preflightOracle(
  setup: ReturnType<typeof preflightRuntime>,
  large: boolean,
): Promise<{
  body: { bytes: number; sha256: string };
  estimate: PromptEnvelopeEstimate;
}> {
  const contents = Array.from(
    { length: 64 },
    (_, index): IContent => diskTextRow(index, large),
  );
  const bytes = Buffer.from(
    JSON.stringify({
      model: 'gpt-5.6',
      input: contents.map((row) => ({
        role: row.speaker === 'human' ? 'user' : 'assistant',
        content: row.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(row.speaker === 'human' ? String.fromCharCode(10) : ''),
      })),
      stream: true,
      instructions: preflightInstructions,
    }),
  );
  const body = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const prepared = await prepareAtSendSeam(setup.provider, {
    contents: {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
        yield* contents;
      },
    },
    config: setup.config,
    runtime: setup.context,
    settings: setup.context.settingsService,
    invocation: setup.invocation,
    systemInstruction: preflightInstructions,
  });
  try {
    if (prepared.estimate === null) throw new Error('Missing native estimate');
    return { body, estimate: prepared.estimate };
  } finally {
    await prepared.releaseIfUnsent?.();
  }
}
export class PreflightExporter extends FileLogExporter {
  readonly pauses = [barrier(), barrier()];
  readonly releases = [barrier(), barrier()];
  private readonly seen = new Set<string>();
  completions = 0;
  constructor(
    path: string,
    private readonly fault: 'hold' | 'reject' | 'no-ack' = 'hold',
  ) {
    super(path);
  }
  releaseAll(): void {
    for (const gate of this.releases) gate.release();
  }
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    const chunk = records.find(
      (record) =>
        record.attributes['event.name'] === 'llxprt_code.api_request_chunk',
    );
    const id = chunk?.attributes.artifact_id;
    if (typeof id !== 'string' || this.seen.has(id)) {
      super.export(records, (result) => {
        if (result.code === ExportResultCode.SUCCESS)
          this.completions += records.filter(
            (record) =>
              record.attributes['event.name'] ===
              'llxprt_code.api_request_complete',
          ).length;
        callback(result);
      });
      return;
    }
    const index = this.seen.size;
    this.seen.add(id);
    super.export(records, (result) => {
      this.pauses[index].release();
      if (this.fault === 'reject')
        callback({
          code: ExportResultCode.FAILED,
          error: new Error('preflight exporter rejected'),
        });
      else if (this.fault === 'hold')
        void this.releases[index].wait.then(() => callback(result));
    });
  }
}
