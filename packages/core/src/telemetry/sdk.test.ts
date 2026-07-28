/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TelemetryConfig } from '@vybestack/llxprt-code-telemetry/telemetry/index.js';
import {
  flushTelemetry,
  initializeTelemetry,
  isTelemetrySdkInitialized,
  shutdownTelemetry,
} from './sdk.js';

function createTelemetryConfig(outfile: string): TelemetryConfig {
  return {
    getTelemetryEnabled: () => true,
    getTelemetryLogPromptsEnabled: () => false,
    getTelemetryOutfile: () => outfile,
    getDebugMode: () => false,
    getConversationLoggingEnabled: () => false,
    getSessionId: () => 'local-sdk-lifecycle',
    getModel: () => 'test-model',
    getEmbeddingModel: () => undefined,
    getSandbox: () => undefined,
    getCoreTools: () => undefined,
    getApprovalMode: () => 'default',
    getContentGeneratorConfig: () => undefined,
    getFileFilteringRespectGitIgnore: () => true,
    getMcpServers: () => undefined,
  };
}

describe('local telemetry SDK lifecycle', () => {
  const directories: string[] = [];

  afterEach(async () => {
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(createTelemetryConfig(''));
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does nothing when flushed or shut down before initialization', async () => {
    const config = createTelemetryConfig('');

    await expect(flushTelemetry()).resolves.toBeUndefined();
    await expect(shutdownTelemetry(config)).resolves.toBeUndefined();
    expect(isTelemetrySdkInitialized()).toBe(false);
  });

  it('initializes idempotently and flushes all local signals to the configured file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-telemetry-sdk-'));
    directories.push(directory);
    const firstOutfile = join(directory, 'first.jsonl');
    const ignoredOutfile = join(directory, 'ignored.jsonl');
    const config = createTelemetryConfig(firstOutfile);

    initializeTelemetry(config);
    initializeTelemetry(createTelemetryConfig(ignoredOutfile));
    const span = trace.getTracer('local-sdk-test').startSpan('local-sdk-span');
    expect(span.isRecording()).toBe(true);
    span.end();
    metrics
      .getMeter('local-sdk-test')
      .createCounter('local-sdk-counter')
      .add(1);
    logs.getLogger('local-sdk-test').emit({ body: 'pending-local-log' });
    await flushTelemetry();
    await shutdownTelemetry(config);

    const telemetry = readFileSync(firstOutfile, 'utf8');
    expect(telemetry).toContain('local-sdk-span');
    expect(telemetry).toContain('local-sdk-counter');
    expect(telemetry).toContain('pending-local-log');
    expect(() => readFileSync(ignoredOutfile, 'utf8')).toThrow(
      /ENOENT|no such file/i,
    );
  });

  it('supports repeated shutdown and a later fresh initialization', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-telemetry-restart-'));
    directories.push(directory);
    const firstConfig = createTelemetryConfig(join(directory, 'first.jsonl'));
    const secondOutfile = join(directory, 'second.jsonl');
    const secondConfig = createTelemetryConfig(secondOutfile);

    initializeTelemetry(firstConfig);
    await shutdownTelemetry(firstConfig);
    await shutdownTelemetry(firstConfig);
    initializeTelemetry(secondConfig);
    logs.getLogger('local-sdk-test').emit({ body: 'after-restart' });
    await flushTelemetry();
    await shutdownTelemetry(secondConfig);

    expect(readFileSync(secondOutfile, 'utf8')).toContain('after-restart');
    expect(isTelemetrySdkInitialized()).toBe(false);
  });
});
