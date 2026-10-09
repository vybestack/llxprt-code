/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRowsForAssertions as withRows } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';
import { ConversationManager } from './ConversationManager.js';

function managerFor(history: HistoryService): ConversationManager {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));
  const providerRuntime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'pairing',
  });
  const providers = new TestRuntimeProviderManager(providerRuntime);
  providers.setConfig(config);
  config.setProviderManager(providers);
  providers.registerProvider({
    name: 'pairing',
    isDefault: true,
    getModels: async () => [],
    getDefaultModel: () => 'test-model',
    async *generateChatCompletion() {},
  });
  return new ConversationManager(
    history,
    createAgentRuntimeContext({
      state: createAgentRuntimeState({
        runtimeId: 'pairing',
        provider: 'pairing',
        model: 'test-model',
        sessionId: config.getSessionId(),
      }),
      history,
      settings: { compressionThreshold: 0.8, contextLimit: 200000 },
      provider: createProviderAdapterFromManager(providers),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime,
    }),
  );
}
function callRow(index: number): IContent {
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: String(index),
        name: `tool-${index}`,
        parameters: { index },
      },
    ],
  };
}

describe('ConversationManager tool pairing cursor', () => {
  for (const size of [512, 8192]) {
    it(`matches ${size} pending calls FIFO with bounded owners and closes on abandonment`, async () => {
      const ownership = new RowOwnership();
      const counters = createRowCounters();
      const history = new HistoryService({
        attachmentCounters: { ...counters.counters, ownership },
      });
      try {
        await history.addBatch(
          Array.from({ length: size }, (_, index) => callRow(index)),
        );
        const manager = managerFor(history);
        const matcher = manager.makePositionMatcher({ ownership });
        let index = 0;
        for await (const match of matcher) {
          expect(match).toStrictEqual({
            historyId: String(index),
            toolName: `tool-${index}`,
          });
          expect(ownership.snapshot().liveRows).toBeLessThanOrEqual(2);
          index += 1;
        }
        expect(index).toBe(size);
        expect(ownership.snapshot().peakRows).toBe(2);
        expect(
          ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        const drainedOwners = ownership.snapshot().liveRows;
        const early = manager.makePositionMatcher({ ownership });
        await early.next();
        await early.return();
        expect({
          drainedOwners,
          abandonedOwners: ownership.snapshot().liveRows,
        }).toStrictEqual({ drainedOwners: 0, abandonedOwners: 0 });
      } finally {
        history.dispose();
      }
    });
  }
});

describe('ConversationManager neutral tool recording', () => {
  it('leaves neutral tool response IDs and blocks intact without prematurely opening a matcher', async () => {
    const counters = createRowCounters();
    const history = new HistoryService({
      attachmentCounters: counters.counters,
    });
    try {
      await history.addBatch([callRow(0)]);
      const manager = managerFor(history);
      const input: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'provider-id',
            toolName: 'provider-tool',
            result: { value: 17 },
          },
        ],
      };
      const converted = manager.convertUserInputToIContents(input);
      expect(converted[0].blocks).toStrictEqual(input.blocks);
      const conversionReads = counters.snapshot().rowsDecoded;
      manager.importInitialHistory([input], 'test-model');
      const importReads = counters.snapshot().rowsDecoded;
      await manager.recordHistory(input, []);
      expect({
        conversionReads,
        importReads,
        recordingReads: counters.snapshot().rowsDecoded,
      }).toStrictEqual({
        conversionReads: 0,
        importReads: 0,
        recordingReads: 0,
      });
      await withRows(history.streamRawHistory(), (rows) => {
        expect(
          rows.filter((row) => row.speaker === 'tool').map((row) => row.blocks),
        ).toStrictEqual([input.blocks, input.blocks]);
      });
    } finally {
      history.dispose();
    }
  });
});

describe('ConversationManager tool cursor exhaustion', () => {
  it('does not pair a call responded to at the end of history and returns done on exhaustion', async () => {
    const history = new HistoryService();
    try {
      await history.addBatch([
        callRow(0),
        callRow(1),
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: '0',
              toolName: 'tool-0',
              result: 0,
            },
          ],
        },
      ]);
      const cursor = managerFor(history).makePositionMatcher();
      expect((await cursor.next()).value).toStrictEqual({
        historyId: '1',
        toolName: 'tool-1',
      });
      expect(await cursor.next()).toStrictEqual({
        done: true,
        value: undefined,
      });
    } finally {
      history.dispose();
    }
  });
});

describe('ConversationManager tool cursor cleanup', () => {
  it('applies backpressure and releases both owners and disk state when a consumer throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'matcher-test-'));
    const ownership = new RowOwnership();
    const history = new HistoryService();
    try {
      await history.addBatch([callRow(0), callRow(1)]);
      const manager = managerFor(history);
      await expect(
        (async (): Promise<void> => {
          for await (const match of manager.makePositionMatcher({
            root,
            ownership,
          })) {
            expect(ownership.snapshot().liveRows).toBe(2);
            await new Promise<void>((resolve) => setTimeout(resolve, 1));
            expect(ownership.snapshot().acquisitions).toBe(2);
            throw new Error(`consumer failed at ${match.historyId}`);
          }
        })(),
      ).rejects.toThrow('consumer failed at 0');
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      history.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
