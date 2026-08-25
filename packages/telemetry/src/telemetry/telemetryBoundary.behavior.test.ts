/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { logApiRequest, logApiResponse } from './loggers.js';
import { ApiRequestEvent, ApiResponseEvent } from './events/api-events.js';
import {
  flushTelemetry,
  initializeTelemetry,
  isTelemetrySdkInitialized,
  shutdownTelemetry,
} from './sdk.js';
import type { TelemetryConfig } from '../internal/interfaces.js';

const SENTINEL = 'SENTINEL-PROMPT-CONTENT-3315';
const directories: string[] = [];

function makeConfig(
  outfile: string,
  overrides?: Partial<TelemetryConfig>,
): TelemetryConfig {
  return {
    getTelemetryEnabled: () => true,
    getTelemetryLogPromptsEnabled: () => false,
    getTelemetryLogApiBodiesEnabled: () => false,
    getTelemetryLogApiBodyMaxChars: () => 4000,
    getTelemetryOutfileMaxBytes: () => 64 * 1024,
    getTelemetryOutfileMaxFiles: () => 4,
    getTelemetryOutfile: () => outfile,
    getDebugMode: () => false,
    getConversationLoggingEnabled: () => false,
    getSessionId: () => 'telemetry-boundary-behavior',
    getModel: () => 'test-model',
    getEmbeddingModel: () => undefined,
    getSandbox: () => undefined,
    getCoreTools: () => undefined,
    getApprovalMode: () => 'default',
    getContentGeneratorConfig: () => undefined,
    getFileFilteringRespectGitIgnore: () => true,
    getMcpServers: () => undefined,
    ...overrides,
  };
}

function allTelemetryFiles(dir: string, outfile: string): string[] {
  const base = basename(outfile);
  return readdirSync(dir)
    .filter((entry) => entry === base || entry.startsWith(`${base}.`))
    .map((entry) => join(dir, entry));
}

describe('telemetry outfile boundary (REQ-3315.7)', () => {
  let outfile = '';

  beforeEach(() => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-tel-boundary-'));
    directories.push(directory);
    outfile = join(directory, 'telemetry.jsonl');
  });

  afterEach(async () => {
    try {
      if (isTelemetrySdkInitialized()) {
        await shutdownTelemetry(makeConfig(outfile));
      }
    } finally {
      for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('bounds the outfile tree and keeps prompt content out with logPrompts:false', async () => {
    const config = makeConfig(outfile);
    initializeTelemetry(config);
    expect(isTelemetrySdkInitialized()).toBe(true);

    for (let i = 0; i < 50; i++) {
      // Large unique body so any leak of request_text would be verbatim and huge.
      logApiRequest(
        config,
        new ApiRequestEvent(
          'test-model',
          `prompt-${i}`,
          SENTINEL + '-' + 'x'.repeat(100 * 1024) + `-${i}`,
        ),
      );
      logApiResponse(
        config,
        new ApiResponseEvent(
          'test-model',
          100 + i,
          `prompt-${i}`,
          {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
          SENTINEL + '-RESP-' + 'y'.repeat(100 * 1024) + `-${i}`,
        ),
      );
    }

    await flushTelemetry();
    await shutdownTelemetry(config);

    const files = allTelemetryFiles(dirname(outfile), outfile);
    const cap = 64 * 1024;
    let totalBytes = 0;
    for (const file of files) {
      const size = statSync(file).size;
      // With bodies redacted every record is small, so no file may even reach
      // the rotation cap. A file at cap + one big record would mean a body
      // leaked through and forced rotation.
      expect(size).toBeLessThanOrEqual(cap);
      totalBytes += size;
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toContain(SENTINEL);
      for (const line of content.trim().split('\n')) {
        if (line.length > 0) JSON.parse(line);
      }
    }
    // 100 redacted records plus SDK overhead must stay far below the cap
    // times-two mark; the previous loose bound (cap * 5 + 201 KiB) could hide
    // a late-rotation regression.
    expect(totalBytes).toBeLessThanOrEqual(2 * cap);

    // request_chars present on api_request records; response_chars on
    // api_response records.
    const activeContent = readFileSync(outfile, 'utf-8');
    expect(activeContent).toContain('request_chars');
    expect(activeContent).toContain('response_chars');
    const apiRequestLine = activeContent
      .trim()
      .split('\n')
      .find((line) => line.includes('"event.name":"llxprt_code.api_request"'));
    expect(apiRequestLine).toBeDefined();
    const parsed = JSON.parse(apiRequestLine!);
    expect(typeof parsed.attributes.request_chars).toBe('number');
  });

  it('rotates and prunes the real outfile when redacted records exceed a small cap', async () => {
    const cap = 2048;
    const maxFiles = 2;
    const config = makeConfig(outfile, {
      getTelemetryOutfileMaxBytes: () => cap,
      getTelemetryOutfileMaxFiles: () => maxFiles,
    });
    initializeTelemetry(config);
    expect(isTelemetrySdkInitialized()).toBe(true);

    // Redacted records are a few hundred bytes each; with a 2 KiB cap this
    // drives multiple rotations and exercises retention pruning.
    for (let i = 0; i < 30; i++) {
      logApiRequest(
        config,
        new ApiRequestEvent(
          'test-model',
          `prompt-${i}`,
          SENTINEL + '-' + 'x'.repeat(100 * 1024) + `-${i}`,
        ),
      );
    }

    await flushTelemetry();
    await shutdownTelemetry(config);

    const base = basename(outfile);
    const entries = readdirSync(dirname(outfile));
    const rotated = entries.filter((entry) =>
      /\.llxprt-rot-\d+-[0-9a-z]{6}$/.test(entry),
    );
    // Rotation must actually engage through the real pipeline, and retention
    // must hold rotated files at maxFiles.
    expect(rotated.length).toBeGreaterThanOrEqual(1);
    expect(rotated.length).toBeLessThanOrEqual(maxFiles);
    expect(entries.filter((e) => e === base).length).toBe(1);

    const files = allTelemetryFiles(dirname(outfile), outfile);
    expect(files.length).toBeLessThanOrEqual(maxFiles + 1);
    for (const file of files) {
      // cap plus at most one in-flight record per write.
      expect(statSync(file).size).toBeLessThanOrEqual(cap + 4096);
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toContain(SENTINEL);
      for (const line of content.trim().split('\n')) {
        if (line.length > 0) JSON.parse(line);
      }
    }
  });
});
