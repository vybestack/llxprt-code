/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { ExportResult } from '@opentelemetry/core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { FileLogExporter } from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import {
  initializeTelemetry,
  shutdownTelemetry,
  flushTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
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
    const active = new Config({
      cwd: root(),
      targetDir: root(),
      sessionId: 'ack',
      model: 'gpt-5.6',
      debugMode: false,
      telemetry: {
        enabled: true,
        logPrompts: true,
        logApiBodies: true,
        logApiBodyMaxChars: 32 * 1024 * 1024,
        outfile: join(root(), 'ack.jsonl'),
      },
    });
    await shutdownTelemetry(active);
    const exporter = new PausedExporter(join(root(), 'ack.jsonl'));
    initializeTelemetry(active, exporter);
    const source = await stageTurnRequestArtifact(
      root(),
      (async function* () {
        for (let index = 0; index < 64; index++)
          yield diskTextRow(index, false);
      })(),
    );
    const adapter = createTelemetryAdapterFromConfig(active);
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
      const legacyFlush = flushTelemetry().then(() => {
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
      await shutdownTelemetry(active);
    }
  }, 30000);
});
