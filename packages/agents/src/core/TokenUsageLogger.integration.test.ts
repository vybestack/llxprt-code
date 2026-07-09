/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ChatSession } from './chatSession.js';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createTokenSyncTestFixture } from './chatSession-tokenSync-helpers.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-int-')),
    'usage.jsonl',
  );
}

function readJsonl(filePath: string): unknown[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

describe('TokenUsageLogger integration — ChatSession streaming', () => {
  let logFile: string;

  beforeEach(() => {
    logFile = makeTempLogPath();
  });

  afterEach(() => {
    const dir = path.dirname(logFile);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('pairs estimate with actual after a normal streaming turn', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockConfig = fixture.mockConfig;
    const providerRuntimeSnapshot = fixture.providerRuntimeSnapshot;
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    const runtimeState: AgentRuntimeState = createAgentRuntimeState({
      runtimeId: fixture.runtimeSetup.runtime.runtimeId,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      sessionId: 'int-test-session',
    });

    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'What is 2+2?' }],
      },
      'claude-3-5-sonnet-20241022',
    );
    await historyService.waitForTokenUpdates();

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'The answer is 4.' }],
        };
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: 5000,
              completionTokens: 15,
              totalTokens: 5015,
            },
          },
          usageMetadata: {
            promptTokenCount: 5000,
            candidatesTokenCount: 15,
            totalTokenCount: 5015,
          },
        };
      }),
    };

    const providerManager = {
      getActiveProvider: vi.fn(() => mockProvider),
    };
    mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 200000,
        preserveThreshold: 0.2,
        telemetry: { enabled: true, target: null },
      },
      provider: createProviderAdapterFromManager(
        mockConfig.getProviderManager() as never,
      ),
      telemetry: createTelemetryAdapterFromConfig(mockConfig),
      tools: createToolRegistryViewFromRegistry(),
      providerRuntime: providerRuntimeSnapshot,
    });

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.compressionHandler.tokenUsageLogger = realLogger;

    const promptId = 'int-prompt-1';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'What is 2+2?' }] },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.prompt_id).toBe(promptId);
    expect(record.estimated_tokens).toBe(150);
    expect(record.actual_prompt_tokens).toBe(5000);
    expect(record.cached_tokens).toBe(0);
    expect(record.effective_actual_tokens).toBe(5000);
  });

  it('records cached_tokens and effective_actual_tokens for cached turns', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockConfig = fixture.mockConfig;
    const providerRuntimeSnapshot = fixture.providerRuntimeSnapshot;
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    const runtimeState: AgentRuntimeState = createAgentRuntimeState({
      runtimeId: fixture.runtimeSetup.runtime.runtimeId,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      sessionId: 'int-test-session-2',
    });

    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello there' }],
      },
      'claude-3-5-sonnet-20241022',
    );
    await historyService.waitForTokenUpdates();

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hi!' }],
        };
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: 5000,
              completionTokens: 10,
              totalTokens: 5010,
              cache_read_input_tokens: 2000,
            },
          },
          usageMetadata: {
            promptTokenCount: 5000,
            candidatesTokenCount: 10,
            totalTokenCount: 5010,
            cachedContentTokenCount: 2000,
          },
        };
      }),
    };

    const providerManager = {
      getActiveProvider: vi.fn(() => mockProvider),
    };
    mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 200000,
        preserveThreshold: 0.2,
        telemetry: { enabled: true, target: null },
      },
      provider: createProviderAdapterFromManager(
        mockConfig.getProviderManager() as never,
      ),
      telemetry: createTelemetryAdapterFromConfig(mockConfig),
      tools: createToolRegistryViewFromRegistry(),
      providerRuntime: providerRuntimeSnapshot,
    });

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.compressionHandler.tokenUsageLogger = realLogger;

    const promptId = 'int-prompt-2';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 300,
      estimator: 'anthropic-char',
      tiktokenTokens: 280,
    });

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'Hello there' }] },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.prompt_id).toBe(promptId);
    expect(record.actual_prompt_tokens).toBe(5000);
    expect(record.cached_tokens).toBe(2000);
    expect(record.effective_actual_tokens).toBe(3000);
  });
});
