/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { ExportResult } from '@opentelemetry/core';
import { createTelemetryAdapter } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import {
  FileLogExporter,
  FileMetricExporter,
  FileSpanExporter,
} from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';

const root = sourceRootSetup();
class PausedExporter extends FileLogExporter {
  readonly arrived: Promise<void>;
  private arrive: () => void = () => undefined;
  private callback: (() => void) | undefined;
  private paused = false;
  constructor(path: string) {
    super(path);
    this.arrived = new Promise((resolve) => {
      this.arrive = resolve;
    });
  }
  release(): void {
    this.callback?.();
  }
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    super.export(records, (result) => {
      if (
        !this.paused &&
        records.some(
          (record) =>
            record.attributes['event.name'] === 'llxprt_code.api_request_chunk',
        )
      ) {
        this.paused = true;
        this.callback = () => callback(result);
        this.arrive();
      } else callback(result);
    });
  }
}
describe('real SDK concurrent per-chunk acknowledgement', () => {
  it('does not resolve either attempt or a legacy flush while an actual chunk ACK is held', async () => {
    const outfile = join(root(), 'ack.jsonl');
    const exporter = new PausedExporter(outfile);
    const telemetry = await RootTelemetry.create(
      {
        sessionId: 'ack',
        enabled: true,
        outfile,
        maxBytes: 104857600,
        maxFiles: 10,
        readPrivacySettings: () => ({
          logPrompts: true,
          logConversations: false,
          logApiBodies: true,
          maxChars: 32 * 1024 * 1024,
        }),
      },
      () => ({
        tracer: new FileSpanExporter(outfile),
        logger: exporter,
        meter: new FileMetricExporter(outfile),
      }),
    );
    const source = await stageTurnRequestArtifact(
      root(),
      (async function* () {
        for (let index = 0; index < 64; index++)
          yield diskTextRow(index, false);
      })(),
    );
    const adapter = createTelemetryAdapter({ getSessionId: () => 'ack' }, telemetry);
    let completed = 0;
    const attempts = ['first', 'second'].map((promptId) =>
      Promise.resolve(
        adapter.logApiRequest({
          model: 'gpt-5.6',
          promptId,
          requestArtifact: {
            schema_version: 3,
            serialization: 'independent-safe-json-rows-v1',
            source,
          },
        }),
      ).then(() => {
        completed++;
      }),
    );
    try {
      await exporter.arrived;
      let flushed = false;
      const legacyFlush = telemetry.flush().then(() => {
        flushed = true;
      });
      await Bun.sleep(100);
      const beforeRelease = { completed, flushed };
      exporter.release();
      await Promise.all([...attempts, legacyFlush]);
      expect(beforeRelease).toStrictEqual({ completed: 0, flushed: false });
      expect(completed).toBe(2);
    } finally {
      exporter.release();
      await telemetry.close();
    }
  }, 30000);
});
