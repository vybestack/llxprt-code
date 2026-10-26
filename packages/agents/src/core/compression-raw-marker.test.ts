/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { emitCompressionLifecycleEvent } from '../compression/compressionLifecycleTelemetry.js';

for (const size of [65]) {
  describe(`compression chronology over ${size} journal rows`, () => {
    it('records the current turn and compression provenance while owning one raw row', async () => {
      const root = mkdtempSync(join(tmpdir(), 'raw-compression-log-test-'));
      const file = join(root, 'usage.jsonl');
      try {
        await withSuffixFixture(
          size,
          async (history, ownership, counters) => {
            const setup = createChatSessionRuntime();
            const state = createAgentRuntimeState({
              runtimeId: 'compression-runtime',
              sessionId: 'compression-session',
              provider: 'test-provider',
              model: 'test-model',
            });
            const invocationOwner = new SessionSettingsOwner(
              setup.settingsService,
            );
            invocationOwner.bindTelemetry(setup.config);
            const context = createAgentRuntimeContext({
              prepareProviderInvocation: (name, parameters, signal) =>
                invocationOwner.prepareProviderInvocation(
                  state.runtimeId,
                  name,
                  parameters,
                  signal,
                ),
              state,
              history,
              settings: {
                compressionThreshold: 0.5,
                contextLimit: 200_000,
                preserveThreshold: 0.2,
                telemetry: { enabled: false, target: null },
              },
              provider: createProviderAdapterFromManager(setup.providerManager),
              telemetry: createTelemetryAdapter(
                setup.config,
                invocationOwner.telemetry,
              ),
              tools: createToolRegistryViewFromRegistry(),
              providerRuntime: setup.runtime,
            });
            const logger = new TokenUsageLogger(true, file);
            try {
              await emitCompressionLifecycleEvent(
                logger,
                context,
                history,
                () => ({ provider: setup.provider, runtime: setup.runtime }),
                1000,
                100,
                undefined,
              );
            } finally {
              await invocationOwner.dispose();
            }
            const record: unknown = JSON.parse(
              readFileSync(file, 'utf8').trim(),
            );
            expect(record).toMatchObject({
              record_type: 'compression',
              turn_id: `turn:${size - 1}`,
              tokens_before: 1000,
              tokens_after: 100,
              compression_provider: 'test-provider',
            });
            expect(counters.snapshot().rowsDecoded).toBeLessThanOrEqual(size);
            expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(1);
            expect(ownership.snapshot().liveRows).toBe(0);
          },
          0,
          (index) => ({
            ...suffixRow(index),
            metadata: { ...suffixRow(index).metadata, turnId: `turn:${index}` },
          }),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, 120_000);
  });
}
