/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
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
    getTelemetryLogApiBodiesEnabled: () => false,
    getTelemetryLogApiBodyMaxChars: () => 4000,
    getTelemetryOutfileMaxBytes: () => 104857600,
    getTelemetryOutfileMaxFiles: () => 10,
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

function prepareRoot(config: TelemetryConfig): RootTelemetry {
  return RootTelemetry.prepare({
    enabled: config.getTelemetryEnabled(),
    sessionId: config.getSessionId(),
    outfile: config.getTelemetryOutfile(),
    maxBytes: config.getTelemetryOutfileMaxBytes(),
    maxFiles: config.getTelemetryOutfileMaxFiles(),
  });
}

describe('local telemetry SDK lifecycle', () => {
  const roots: RootTelemetry[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    const results = await Promise.allSettled(
      roots.splice(0).map((root) => root.close()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'SDK fixture cleanup failed');
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does nothing when flushed or shut down before initialization', async () => {
    const selected = prepareRoot(createTelemetryConfig(''));
    roots.push(selected);

    await expect(flushTelemetry(selected)).resolves.toBeUndefined();
    await expect(shutdownTelemetry(selected)).resolves.toBeUndefined();
    expect(isTelemetrySdkInitialized(selected)).toBe(false);
  });

  it('initializes idempotently and flushes all local signals to the configured file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-telemetry-sdk-'));
    directories.push(directory);
    const firstOutfile = join(directory, 'first.jsonl');
    const ignoredOutfile = join(directory, 'ignored.jsonl');
    const selected = prepareRoot(createTelemetryConfig(firstOutfile));
    const unselected = RootTelemetry.prepare({
      enabled: false,
      sessionId: 'disabled-peer',
      outfile: ignoredOutfile,
      maxBytes: 1048576,
      maxFiles: 2,
    });
    roots.push(selected, unselected);

    await initializeTelemetry(selected);
    await initializeTelemetry(selected);
    unselected.events.record(() => {
      throw new Error('An unselected SDK peer collected into its target');
    });
    unselected.spans.start('DENIED-PEER-SPAN').end();
    unselected.measurements.modelResponse('DENIED-PEER-MODEL', 1, 200);
    await unselected.flush();
    const span = selected.spans.start('local-sdk-span');
    expect(selected.isEnabled()).toBe(true);
    span.end();
    selected.measurements.modelResponse('local-sdk-counter', 1, 200);
    selected.events.record(() => ({ body: 'pending-local-log' }));
    await flushTelemetry(selected);
    await shutdownTelemetry(selected);

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

    const first = prepareRoot(firstConfig);
    const selected = prepareRoot(secondConfig);
    roots.push(first, selected);
    await initializeTelemetry(first);
    await shutdownTelemetry(first);
    await shutdownTelemetry(first);
    await initializeTelemetry(selected);
    selected.events.record(() => ({ body: 'after-restart' }));
    await flushTelemetry(selected);
    await shutdownTelemetry(selected);

    expect(readFileSync(secondOutfile, 'utf8')).toContain('after-restart');
    expect(isTelemetrySdkInitialized(selected)).toBe(false);
  });
});
