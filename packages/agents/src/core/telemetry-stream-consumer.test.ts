/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapter } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  FileLogExporter,
  FileMetricExporter,
  FileSpanExporter,
} from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import {
  createRootTelemetry,
  type RootTelemetry,
} from '@vybestack/llxprt-code-telemetry';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { stageRequestArtifactFixture } from './__tests__/support/request-artifact-fixture.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';

const root = sourceRootSetup();
type Fault =
  | 'corrupt'
  | 'drop'
  | 'sequence'
  | 'oversize'
  | 'write'
  | 'abort'
  | 'no-ack';
class FaultExporter extends FileLogExporter {
  private changed = false;
  private held: (() => void) | undefined;
  constructor(
    path: string,
    private readonly fault: Fault,
    private readonly controller: AbortController,
  ) {
    super(path);
  }
  /** Completes a transport callback the test withheld, so teardown can join it. */
  releaseHeld(): void {
    this.held?.();
    this.held = undefined;
  }
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    const chunk = records.find(
      (record) =>
        record.attributes['event.name'] === 'llxprt_code.api_request_chunk',
    );
    if (chunk === undefined || this.changed) {
      super.export(records, callback);
      return;
    }
    this.changed = true;
    if (this.fault === 'no-ack') {
      super.export(records, (result) => {
        this.held = () => callback(result);
      });
      return;
    }
    if (this.fault === 'drop') {
      callback({ code: ExportResultCode.SUCCESS });
      return;
    }
    if (this.fault === 'write') {
      callback({
        code: ExportResultCode.FAILED,
        error: new Error('disk rejected chunk'),
      });
      return;
    }
    if (this.fault === 'abort') {
      super.export(records, (result) => {
        this.controller.abort(new Error('abort after ACK'));
        callback(result);
      });
      return;
    }
    const data = chunk.attributes.chunk_data;
    if (typeof data !== 'string') throw new Error('Expected chunk data');
    const bytes = Buffer.from(data, 'base64');
    bytes[10] ^= 1;
    const attributes = {
      ...chunk.attributes,
      ...(this.fault === 'corrupt'
        ? { chunk_data: bytes.toString('base64') }
        : {}),
      ...(this.fault === 'sequence' ? { chunk_index: 9 } : {}),
      ...(this.fault === 'oversize'
        ? { chunk_data: Buffer.alloc(16385).toString('base64') }
        : {}),
    };
    super.export(
      records.map((record) =>
        record === chunk ? { ...record, attributes } : record,
      ),
      callback,
    );
  }
}
function active(): Config {
  return new Config({
    cwd: root(),
    targetDir: root(),
    sessionId: 'fault',
    model: 'gpt-5.6',
    debugMode: false,
    telemetry: {
      enabled: true,
      logPrompts: true,
      logApiBodies: true,
      logApiBodyMaxChars: 32 * 1024 * 1024,
      outfile: join(root(), 'fault.jsonl'),
    },
  });
}
function activeRoot(
  config: Config,
  exporter: FileLogExporter,
): Promise<RootTelemetry> {
  const outfile = config.getTelemetryOutfile();
  if (outfile === undefined) throw new Error('Expected a telemetry outfile');
  return createRootTelemetry(
    {
      sessionId: config.getSessionId(),
      enabled: config.getTelemetryEnabled(),
      outfile,
      maxBytes: config.getTelemetryOutfileMaxBytes(),
      maxFiles: config.getTelemetryOutfileMaxFiles(),
      readPrivacySettings: () => ({
        logPrompts: config.getTelemetryLogPromptsEnabled(),
        logConversations: false,
        logApiBodies: config.getTelemetryLogApiBodiesEnabled(),
        maxChars: config.getTelemetryLogApiBodyMaxChars(),
      }),
    },
    () => ({
      tracer: new FileSpanExporter(outfile),
      logger: exporter,
      meter: new FileMetricExporter(outfile),
    }),
  );
}
describe('actual FileLogExporter acknowledges only verified chunk protocol', () => {
  it.each([
    'corrupt',
    'drop',
    'sequence',
    'oversize',
    'write',
    'abort',
    'no-ack',
  ] as const)(
    'rejects %s without durable completion',
    async (fault) => {
      const config = active();
      const controller = new AbortController();
      const exporter = new FaultExporter(
        join(root(), 'fault.jsonl'),
        fault,
        controller,
      );
      const telemetry = await activeRoot(config, exporter);
      const failure = {
        corrupt: 'digest',
        drop: 'sequence',
        sequence: 'sequence',
        oversize: 'size',
        write: 'disk rejected chunk',
        abort: 'abort after ACK',
        'no-ack': 'acknowledgement',
      }[fault];
      try {
        const source = await stageRequestArtifactFixture(
          root(),
          (async function* () {
            for (let index = 0; index < 64; index++)
              yield diskTextRow(index, true);
          })(),
        );
        await expect(
          createTelemetryAdapter(config, telemetry).logApiRequest({
            model: 'gpt-5.6',
            promptId: fault,
            requestArtifact: {
              schema_version: 3,
              serialization: 'independent-safe-json-rows-v1',
              source,
            },
            signal: controller.signal,
          }),
        ).rejects.toThrow(failure);
        const text = await readFile(join(root(), 'fault.jsonl'), 'utf8');
        expect(text).not.toContain('api_request_complete');
      } finally {
        exporter.releaseHeld();
        // Transport failures stay visible: the root reports a rejected export when it closes.
        const closeMessage = await telemetry.close().then(
          () => undefined,
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        );
        const closeReportsFailure = !['abort', 'no-ack'].includes(fault);
        expect(closeMessage !== undefined).toBe(closeReportsFailure);
        expect(closeMessage ?? '').toContain(
          closeReportsFailure ? failure : '',
        );
      }
    },
    120000,
  );
});
