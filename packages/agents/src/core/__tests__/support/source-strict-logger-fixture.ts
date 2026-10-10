/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ReadableLogRecord,
  LogRecordExporter,
} from '@opentelemetry/sdk-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { FileLogExporter } from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import {
  initializeTelemetry,
  flushTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import { LoggingProviderWrapper } from '../../../../../providers/src/LoggingProviderWrapper.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { getRequestSignal } from '@vybestack/llxprt-code-providers/utils/abortSignal.js';
import {
  preflightDisk,
  preflightRuntime,
  preflightInstructions,
} from './source-preflight-fixture.js';
import {
  buildSourceProviderChatOptions,
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PreparedSourcePromptEnvelopeSend,
} from '../../prompt-envelope-source-send.js';
import { stageTurnRequestArtifact } from '../../turn-request-artifact.js';

export type StrictFault =
  | 'none'
  | 'retry'
  | 'abort'
  | 'unsupported'
  | 'api-request'
  | 'conversation-request'
  | 'api-response'
  | 'conversation-response';
export interface StrictReceipt {
  readonly error: { name: string; message: string } | null;
  readonly output: string;
  readonly bodies: ReadonlyArray<{ bytes: number; sha256: string }>;
  readonly events: ReadonlyArray<Record<string, unknown>>;
  readonly rejected: ReadonlyArray<{ names: unknown[]; error: string }>;
  readonly preflights: number;
  readonly retries: number;
  readonly writeFault: string | null;
  readonly closed: number;
  readonly activeReaders: number;
  readonly activeBodies: number;
}
class ObservedFileExporter extends FileLogExporter {
  readonly events: Array<Record<string, unknown>> = [];
  readonly rejected: Array<{ names: unknown[]; error: string }> = [];
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    super.export(records, (result) => {
      if (result.code === ExportResultCode.SUCCESS) {
        for (const record of records) {
          const name = record.attributes['event.name'];
          if (typeof name === 'string' && !name.endsWith('_chunk')) {
            const {
              request_text: _text,
              chunk_data: _data,
              ...scalars
            } = record.attributes;
            this.events.push(scalars);
          }
        }
      } else
        this.rejected.push({
          names: records.map((record) => record.attributes['event.name']),
          error: String(result.error),
        });
      callback(result);
    });
  }
}
class UnsupportedFileExporter implements LogRecordExporter {
  constructor(private readonly file: ObservedFileExporter) {}
  export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    this.file.export(records, callback);
  }
  shutdown(): Promise<void> {
    return this.file.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.file.forceFlush();
  }
}
function blockFile(path: string): void {
  rmSync(path, { force: true });
  mkdirSync(path);
}
async function faultWitness(path: string | undefined): Promise<string | null> {
  if (path === undefined) return null;
  try {
    await appendFile(path, 'write fault witness');
    throw new Error('Filesystem fault was not active');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EISDIR')
      return error.code;
    throw error;
  }
}
function endpoint(
  fault: StrictFault,
  controller: AbortController,
  block: () => void,
  onUploaded?: () => Promise<void>,
) {
  let blocked = false;
  const bodies: Array<{ bytes: number; sha256: string }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      if (request.body === null) throw new Error('Missing HTTP body');
      const reader = request.body.getReader();
      const hash = createHash('sha256');
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
      await onUploaded?.();
      if (fault === 'retry' && bodies.length === 1)
        return new Response('retry', { status: 503 });
      if (fault === 'abort')
        controller.abort(new DOMException('upload aborted', 'AbortError'));
      if (
        !blocked &&
        (fault === 'api-response' || fault === 'conversation-response')
      ) {
        blocked = true;
        block();
      }
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_strict","status":"completed","output":[],"usage":{"input_tokens":123,"output_tokens":1,"total_tokens":124}}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { bodies, server };
}
interface StrictInput {
  readonly controller: AbortController;
  readonly faultPath: string | undefined;
  readonly http: ReturnType<typeof endpoint>;
  readonly setup: ReturnType<typeof preflightRuntime>;
  readonly exporter: ObservedFileExporter;
  readonly fixture: Awaited<ReturnType<typeof preflightDisk>>;
  readonly wrapper: LoggingProviderWrapper;
}
export async function assembleStrict(
  root: string,
  fault: StrictFault,
  onUploaded?: () => Promise<void>,
): Promise<StrictInput> {
  resetConversationFileWriterForTesting();
  const controller = new AbortController();
  const telemetryPath = join(root, 'strict.jsonl');
  const conversationPath = join(
    root,
    `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
  );
  let faultPath: string | undefined;
  if (fault.startsWith('api-')) faultPath = telemetryPath;
  else if (fault.startsWith('conversation-')) faultPath = conversationPath;
  const http = endpoint(
    fault,
    controller,
    () => {
      if (faultPath !== undefined) blockFile(faultPath);
    },
    onUploaded,
  );
  const setup = preflightRuntime(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    true,
  );
  await shutdownTelemetry(setup.config);
  setup.config.updateTelemetrySettings({
    logConversations: true,
    conversationLogPath: root,
    outfile: telemetryPath,
  });
  const exporter = new ObservedFileExporter(telemetryPath);
  initializeTelemetry(
    setup.config,
    fault === 'unsupported' ? new UnsupportedFileExporter(exporter) : exporter,
  );
  const fixture = await preflightDisk(root, false);
  const wrapper = new LoggingProviderWrapper(setup.provider);
  return { controller, faultPath, http, setup, exporter, fixture, wrapper };
}
export async function strictProbe(
  root: string,
  fault: StrictFault,
  source: boolean,
): Promise<StrictReceipt> {
  const input = await assembleStrict(root, fault);
  const { controller, faultPath, http, setup, fixture, wrapper } = input;
  let preflights = 0;
  let retries = 0;
  let output = '';
  let failure: unknown;
  try {
    if (fault.endsWith('-request') && faultPath !== undefined)
      blockFile(faultPath);
    const stream = source
      ? await enforceAndStreamSourcePromptEnvelopeRetries({
          provider: wrapper,
          source: fixture.source,
          signal: controller.signal,
          buildOptions: (rows) => ({
            ...buildSourceProviderChatOptions(
              rows,
              undefined,
              setup.context,
              setup.invocation,
              undefined,
              preflightInstructions,
            ),
            resolved: { model: 'gpt-5.6' },
          }),
          enforce: async (rows, estimate) => {
            await estimate(rows);
            return rows;
          },
          onPrepared: async (prepared): Promise<void> => {
            preflights++;
            if (fault === 'unsupported')
              await publishPreflight(root, setup, prepared);
          },
          shouldRetryOnError: (error) => {
            retries++;
            return (
              error instanceof Error &&
              'status' in error &&
              error.status === 503
            );
          },
        })
      : wrapper.generateChatCompletion({
          contents: {
            [Symbol.asyncIterator]: () =>
              fixture.source.openReader(controller.signal),
          },
          config: setup.config,
          runtime: setup.context,
          settings: setup.context.settingsService,
          invocation: { ...setup.invocation, signal: controller.signal },
          systemInstruction: preflightInstructions,
          resolved: { model: 'gpt-5.6' },
        });
    for await (const row of stream)
      output += row.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
  } catch (error: unknown) {
    failure = error;
  } finally {
    if (!source) await fixture.source.close();
    await flushTelemetry();
    await http.server.stop(true);
  }
  return captureStrictReceipt(input, fault, source, {
    failure,
    output,
    preflights,
    retries,
  });
}
async function captureStrictReceipt(
  input: StrictInput,
  fault: StrictFault,
  source: boolean,
  state: {
    failure: unknown;
    output: string;
    preflights: number;
    retries: number;
  },
): Promise<StrictReceipt> {
  const { failure, output, preflights, retries } = state;
  const { faultPath, http, setup, exporter, fixture } = input;
  const receipt: StrictReceipt = {
    error:
      failure === undefined
        ? null
        : {
            name: failure instanceof Error ? failure.name : 'unknown',
            message: String(failure),
          },
    output,
    bodies: http.bodies,
    events: exporter.events,
    rejected: exporter.rejected,
    preflights,
    retries,
    writeFault: await faultWitness(faultPath),
    closed: fixture.state.closed,
    activeReaders: fixture.state.active,
    activeBodies: activeRequestBodyCount(),
  };
  await shutdownTelemetry(setup.config);
  await setup.config.dispose();
  resetConversationFileWriterForTesting();
  return receipt;
}
async function publishPreflight(
  root: string,
  setup: ReturnType<typeof preflightRuntime>,
  prepared: PreparedSourcePromptEnvelopeSend,
): Promise<void> {
  const signal = getRequestSignal(prepared.options);
  const artifact = await stageTurnRequestArtifact(
    root,
    { [Symbol.asyncIterator]: () => prepared.source.openReader(signal) },
    signal,
  );
  try {
    await createTelemetryAdapterFromConfig(setup.config).logApiRequest({
      model: 'gpt-5.6',
      promptId: 'strict-preflight',
      requestArtifact: {
        schema_version: 3,
        serialization: 'independent-safe-json-rows-v1',
        source: artifact,
      },
      signal,
    });
  } finally {
    rmSync(artifact.artifact_path);
  }
}
