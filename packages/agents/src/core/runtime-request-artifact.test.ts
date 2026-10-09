/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { FileLogExporter } from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { RuntimeRequestArtifact } from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import {
  initializeTelemetry,
  isTelemetrySdkInitialized,
  flushTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';

import { getRequestTextFromContents } from './turnLogging.js';
import {
  runtimeConfig,
  runtimeArtifact,
  sendRuntimeArtifact,
  runtimeWriteFailure,
  runtimeRelease,
} from './runtime-request-lifecycle-test-helpers.js';

const root = sourceRootSetup();
const eventSchema = z.object({ attributes: z.record(z.unknown()).optional() });
function config(cap = 4000, enabled = true): Config {
  return runtimeConfig(root(), cap, enabled);
}
async function events(): Promise<Array<Record<string, unknown>>> {
  return (await readFile(join(root(), 'runtime.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .flatMap((line) => {
      const attributes = eventSchema.parse(JSON.parse(line)).attributes;
      return attributes === undefined ? [] : [attributes];
    })
    .filter((attributes) =>
      String(attributes['event.name']).startsWith('llxprt_code.api_request'),
    );
}
function digest(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}
function visibleText(records: Array<Record<string, unknown>>): string {
  const bytes = records
    .filter(
      (record) => record['event.name'] === 'llxprt_code.api_request_chunk',
    )
    .map((record) =>
      Buffer.from(z.string().parse(record.chunk_data), 'base64'),
    );
  return z.string().parse(JSON.parse(Buffer.concat(bytes).toString('utf8')));
}
async function artifact(large = false): Promise<RuntimeRequestArtifact> {
  return runtimeArtifact(root(), large);
}
async function send(
  staged: RuntimeRequestArtifact,
  active: Config,
  signal?: AbortSignal,
): Promise<void> {
  return sendRuntimeArtifact(staged, active, signal);
}
function verify(
  records: Array<Record<string, unknown>>,
  visible: string,
  staged: RuntimeRequestArtifact,
): void {
  const requests = records.filter(
    (event) => event['event.name'] === 'llxprt_code.api_request',
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    prompt_id: 'runtime-fallback',
    request_chars: staged.source.content_chars,
    request_text_protocol: 'json-string-chunks-v1',
    schema_version: 4,
    content_sha256: staged.source.content_sha256,
    content_bytes: staged.source.content_bytes,
    visible_chars: visible.length,
    visible_bytes: Buffer.byteLength(JSON.stringify(visible)),
    visible_sha256: digest(JSON.stringify(visible)),
    truncated: visible.length < staged.source.content_chars,
  });
  const chunks = records.filter(
    (event) => event['event.name'] === 'llxprt_code.api_request_chunk',
  );
  let offset = 0;
  const bytes: Buffer[] = [];
  for (const [index, chunk] of chunks.entries()) {
    expect(chunk).toMatchObject({
      chunk_index: index,
      chunk_byte_offset: offset,
      artifact_id: staged.source.artifact_id,
    });
    const decoded = Buffer.from(z.string().parse(chunk.chunk_data), 'base64');
    expect(decoded.length).toBeLessThanOrEqual(16384);
    bytes.push(decoded);
    offset += decoded.length;
    expect(chunk.request_text).toBeUndefined();
  }
  expect(
    Buffer.concat(bytes).equals(Buffer.from(JSON.stringify(visible))),
  ).toBe(true);
  expect(JSON.parse(Buffer.concat(bytes).toString('utf8'))).toBe(visible);
  expect(records[records.length - 1]).toMatchObject({
    'event.name': 'llxprt_code.api_request_complete',
    content_complete: true,
    chunk_count: chunks.length,
    visible_sha256: digest(JSON.stringify(visible)),
  });
  expect(
    records.every(
      (event) => !('artifact_path' in event) && !('content_offset' in event),
    ),
  ).toBe(true);
}

describe('awaited actual runtime request artifact exporter', () => {
  it.each([false, true])(
    'preserves capped legacy visible text and full digest with 64 rows, large=%s',
    async (large) => {
      const active = config();
      initializeTelemetry(active);
      try {
        const staged = await artifact(large);
        const operation = createTelemetryAdapterFromConfig(
          active,
        ).logApiRequest({
          model: 'gpt-5.6',
          runtimeId: 'runtime-fallback',
          requestArtifact: staged,
        });
        expect(operation instanceof Promise).toBe(true);
        await operation;
        const records = await events();
        const visible = getRequestTextFromContents(
          Array.from({ length: 64 }, (_, index) => diskTextRow(index, false)),
        ).slice(0, 4000);
        verify(records, visible, staged);
        expect(staged.source.content_bytes).toBeGreaterThan(
          large ? 10 * 1024 * 1024 : 4000,
        );
        const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
        if (evidence !== undefined)
          await writeFile(
            join(evidence, `runtime-${large}-${process.pid}.jsonl`),
            await readFile(join(root(), 'runtime.jsonl')),
          );
      } finally {
        await shutdownTelemetry(active);
      }
    },
    60000,
  );
});

describe('runtime artifact UTF-16 cap compatibility', () => {
  it.each([1, 2, 3, 4000, 50000])(
    'preserves UTF-16 slice cap %s including split surrogate',
    async (cap) => {
      const active = config(cap);
      initializeTelemetry(active);
      try {
        const text = '🌊雪'.repeat(6000);
        const path = join(root(), 'unicode.txt');
        await writeFile(path, text);
        const staged: RuntimeRequestArtifact = {
          schema_version: 3,
          serialization: 'legacy-request-text-v1',
          source: {
            schema_version: 2,
            artifact_id: 'unicode',
            artifact_path: path,
            content_offset: 0,
            content_chars: text.length,
            content_bytes: Buffer.byteLength(text),
            content_sha256: digest(text),
            row_count: 0,
          },
        };
        await send(staged, active);
        const records = await events();
        expect(records[0].request_text).toBeUndefined();
        expect(visibleText(records)).toBe(text.slice(0, cap));
        verify(records, text.slice(0, cap), staged);
      } finally {
        await shutdownTelemetry(active);
      }
    },
  );
});

describe('runtime artifact scalar compatibility', () => {
  it('preserves the scalar legacy request-wide shared-row identity event', async () => {
    const active = config(50000);
    initializeTelemetry(active);
    try {
      const shared = diskTextRow(0, false);
      const text = getRequestTextFromContents([shared, shared]);
      await createTelemetryAdapterFromConfig(active).logApiRequest({
        model: 'gpt-5.6',
        requestText: text,
        promptId: 'shared',
      });
      await flushTelemetry();
      expect(
        (await events()).filter(
          (event) => event['event.name'] === 'llxprt_code.api_request',
        )[0],
      ).toMatchObject({
        request_text: text,
        request_chars: text.length,
        prompt_id: 'shared',
      });
      expect(text).toContain('"[Circular]"');
    } finally {
      await shutdownTelemetry(active);
    }
  });
  it('disabled body toggles retain counts without opening deleted artifact content', async () => {
    const active = config(4000, false);
    initializeTelemetry(active);
    try {
      const staged = await artifact();
      await rm(staged.source.artifact_path);
      await send(staged, active);
      await flushTelemetry();
      const records = await events();
      expect(records).toHaveLength(1);
      expect(records[0].request_chars).toBe(staged.source.content_chars);
      expect(records[0].request_text).toBeUndefined();
      expect(records[0].artifact_id).toBeUndefined();
    } finally {
      await shutdownTelemetry(active);
    }
  });
});

describe('artifact exporter failure contract', () => {
  it.each(['abort', 'digest', 'truncate', 'chars'] as const)(
    'rejects %s without completion or scalar publication',
    async (mode) => {
      const active = config();
      initializeTelemetry(active);
      try {
        const staged = await artifact();
        const controller = new AbortController();
        if (mode === 'abort') controller.abort(new Error('cancel artifact'));
        if (mode === 'truncate')
          await writeFile(staged.source.artifact_path, '[');
        const input = {
          ...staged,
          source: {
            ...staged.source,
            ...(mode === 'digest' ? { content_sha256: '0'.repeat(64) } : {}),
            ...(mode === 'chars' ? { content_chars: 1 } : {}),
          },
        };
        const messages = {
          abort: 'cancel artifact',
          digest: 'digest mismatch',
          truncate: 'Truncated request artifact',
          chars: 'character count mismatch',
        };
        await expect(send(input, active, controller.signal)).rejects.toThrow(
          messages[mode],
        );
        await flushTelemetry();
        expect(
          await readFile(join(root(), 'runtime.jsonl'), 'utf8').catch(() => ''),
        ).not.toContain('api_request');
      } finally {
        await shutdownTelemetry(active);
      }
    },
  );
  it('rejects an ordinary external exporter without changing its schema', async () => {
    const active = config();
    const records: unknown[] = [];
    const exporter: LogRecordExporter = {
      export(batch, callback): void {
        records.push(...batch);
        callback({ code: ExportResultCode.SUCCESS });
      },
      shutdown: async (): Promise<void> => undefined,
      forceFlush: async (): Promise<void> => undefined,
    };
    await shutdownTelemetry(active);
    initializeTelemetry(active, exporter);
    try {
      await expect(send(await artifact(), active)).rejects.toThrow(
        'does not support request artifact schema 4',
      );
      expect(records).toHaveLength(0);
    } finally {
      await shutdownTelemetry(active);
    }
  });
  it('rejects acknowledged exporter write failure rather than claiming completion', async () => {
    await runtimeWriteFailure(root());
    expect(isTelemetrySdkInitialized()).toBe(false);
  });
});

describe('actual runtime artifact release', () => {
  it('releases its >10MiB reader and bounded chunks below unchanged 1MiB', async () => {
    await runtimeRelease(root());
    expect(isTelemetrySdkInitialized()).toBe(false);
  }, 60000);
});

class AbortingFileExporter extends FileLogExporter {
  constructor(
    path: string,
    private readonly controller: AbortController,
  ) {
    super(path);
  }
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    super.export(records, (result) => {
      if (
        records.some(
          (record) =>
            record.attributes['event.name'] === 'llxprt_code.api_request_chunk',
        )
      ) {
        this.controller.abort(new Error('cancel after first exported chunk'));
      }
      callback(result);
    });
  }
}

describe('runtime artifact cancellation and legacy identity', () => {
  it('aborts between acknowledged chunks with one scalar request and no completion', async () => {
    const active = config(50000);
    const controller = new AbortController();
    await shutdownTelemetry(active);
    initializeTelemetry(
      active,
      new AbortingFileExporter(join(root(), 'runtime.jsonl'), controller),
    );
    try {
      await expect(
        send(await artifact(), active, controller.signal),
      ).rejects.toThrow('cancel after first exported chunk');
      const records = await events();
      expect(
        records.filter(
          (record) => record['event.name'] === 'llxprt_code.api_request',
        ),
      ).toHaveLength(1);
      expect(
        records.filter(
          (record) => record['event.name'] === 'llxprt_code.api_request_chunk',
        ),
      ).toHaveLength(1);
      expect(records.some((record) => record.content_complete === true)).toBe(
        false,
      );
      expect(records[1].chunk_byte_offset).toBe(0);
    } finally {
      await shutdownTelemetry(active);
    }
  });
  it('preserves shared-row identity when the artifact is the existing legacy request text', async () => {
    const active = config(50000);
    initializeTelemetry(active);
    try {
      const shared = diskTextRow(0, false);
      const text = getRequestTextFromContents([shared, shared]);
      const path = join(root(), 'legacy-shared.txt');
      await writeFile(path, text);
      const staged: RuntimeRequestArtifact = {
        schema_version: 3,
        serialization: 'legacy-request-text-v1',
        source: {
          schema_version: 2,
          artifact_id: 'legacy-shared',
          artifact_path: path,
          content_offset: 0,
          content_bytes: Buffer.byteLength(text),
          content_chars: text.length,
          content_sha256: digest(text),
          row_count: 2,
        },
      };
      await send(staged, active);
      const records = await events();
      expect(records[0].request_text).toBeUndefined();
      expect(visibleText(records)).toBe(text);
      verify(records, text, staged);
      expect(JSON.parse(text)[1]).toBe('[Circular]');
    } finally {
      await shutdownTelemetry(active);
    }
  });
});

describe('unambiguous runtime artifact observation', () => {
  it('rejects ambiguous text plus artifact rather than choosing one observation', async () => {
    const active = config();
    initializeTelemetry(active);
    try {
      const staged = await artifact();
      expect(() =>
        createTelemetryAdapterFromConfig(active).logApiRequest({
          model: 'gpt-5.6',
          requestText: 'conflicting input',
          requestArtifact: staged,
        }),
      ).toThrow('both text and artifact');
    } finally {
      await shutdownTelemetry(active);
    }
  });
});
