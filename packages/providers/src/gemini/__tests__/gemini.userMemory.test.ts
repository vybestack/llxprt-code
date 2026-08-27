/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test for Issue #409: Context memory is lost when switching profiles
 *
 * This test verifies that userMemory (context files) is properly preserved
 * and injected into requests when using GeminiProvider, especially when
 * switching between authentication modes or providers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { GeminiProvider } from '../GeminiProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const googleGenAIState = {
  instances: [] as Array<{ options: Record<string, unknown> }>,
  streamCalls: [] as Array<{ request: Record<string, unknown> }>,
  nonStreamCalls: [] as Array<{ request: Record<string, unknown> }>,
  streamPlans: [] as Array<Array<Record<string, unknown>>>,
};

void vi.mock('@google/genai', () => {
  class FakeGoogleGenAI {
    readonly models: {
      generateContentStream: ReturnType<typeof vi.fn>;
      generateContent: ReturnType<typeof vi.fn>;
    };

    constructor(opts: Record<string, unknown>) {
      googleGenAIState.instances.push({ options: opts });
      this.models = {
        generateContentStream: vi.fn(async function* (
          request: Record<string, unknown>,
        ) {
          googleGenAIState.streamCalls.push({ request });
          const plan = googleGenAIState.streamPlans.shift() ?? [];
          for (const response of plan) {
            yield response;
          }
        }),
        generateContent: vi.fn(async (request: Record<string, unknown>) => {
          googleGenAIState.nonStreamCalls.push({ request });
          return {
            candidates: [
              {
                content: {
                  parts: [{ text: 'test response' }],
                },
              },
            ],
          };
        }),
      };
    }
  }

  // Mirrors the real Gemini schema-type constant, which is uppercase.
  const Type = { OBJECT: 'OBJECT' };

  return { GoogleGenAI: FakeGoogleGenAI, Type };
});

const queueGoogleStream = (responses: Array<Record<string, unknown>>): void => {
  googleGenAIState.streamPlans.push(responses);
};

describe('GeminiProvider userMemory preservation (Issue #409)', () => {
  let settingsService: SettingsService;
  let config: Config;
  const TEST_USER_MEMORY =
    'Test context from AGENTS.md: Create commit.bat when asked';
  // Simulates the COMPLETE prompt the agent layer assembles (issue #3136):
  // core prompt + user memory baked in. Providers transport this verbatim
  // and never rebuild a core prompt from userMemory.
  const ASSEMBLED_PROMPT = `You are a helpful assistant.

# LLxprt Code Added Memories
${TEST_USER_MEMORY}`;

  beforeEach(() => {
    vi.clearAllMocks();
    googleGenAIState.instances = [];
    googleGenAIState.streamCalls = [];
    googleGenAIState.nonStreamCalls = [];
    googleGenAIState.streamPlans = [];

    settingsService = new SettingsService();
    settingsService.set('activeProvider', 'gemini');

    // Create config with userMemory
    config = createRuntimeConfigStub({
      userMemory: TEST_USER_MEMORY,
    });

    // Set up runtime context
    const runtime = createProviderRuntimeContext({
      settingsService,
      config,
    });
    setActiveProviderRuntimeContext(runtime);

    // Set up Gemini API key for non-OAuth mode
    process.env.GEMINI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    delete process.env.GEMINI_API_KEY;
  });

  it('should include userMemory in system prompt for API key authentication', async () => {
    const provider = new GeminiProvider(
      process.env.GEMINI_API_KEY,
      undefined,
      config,
    );

    // Create call options with runtime context
    const runtime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test-runtime-api-key',
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings: settingsService,
      providerName: 'gemini',
      userMemory: TEST_USER_MEMORY,
      ephemeralsSnapshot: {},
    });

    const options = createProviderCallOptions({
      providerName: 'gemini',
      contents: [
        {
          speaker: 'human' as const,
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ],
      resolved: {
        model: 'gemini-2.5-pro',
      },
      runtime,
      invocation,
      userMemory: TEST_USER_MEMORY,
      systemInstruction: ASSEMBLED_PROMPT,
    });

    // Queue a response
    queueGoogleStream([
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hi there!' }],
            },
          },
        ],
      },
    ]);

    // Make the call
    const chunks: unknown[] = [];
    for await (const chunk of provider.generateChatCompletion(options)) {
      chunks.push(chunk);
    }

    // Issue #3136: providers transport options.systemInstruction verbatim.
    // The user memory now lives in the agent-assembled instruction, so verify
    // it reaches the Gemini request systemInstruction field exactly once.
    expect(googleGenAIState.streamCalls.length).toBe(1);
    const request = googleGenAIState.streamCalls[0].request;
    expect(request).toHaveProperty('systemInstruction');
    expect(request.systemInstruction).toBe(ASSEMBLED_PROMPT);
  });

  it('should preserve userMemory after simulated profile switch', async () => {
    // First call with initial provider
    const provider1 = new GeminiProvider(
      process.env.GEMINI_API_KEY,
      undefined,
      config,
    );

    const runtime1 = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test-runtime-switch-1',
    });

    const invocation1 = createRuntimeInvocationContext({
      runtime: runtime1,
      settings: settingsService,
      providerName: 'gemini',
      userMemory: TEST_USER_MEMORY,
      ephemeralsSnapshot: {},
    });

    const options1 = createProviderCallOptions({
      providerName: 'gemini',
      contents: [
        {
          speaker: 'human' as const,
          blocks: [{ type: 'text' as const, text: 'First request' }],
        },
      ],
      resolved: {
        model: 'gemini-2.5-flash',
      },
      runtime: runtime1,
      invocation: invocation1,
      userMemory: TEST_USER_MEMORY,
      systemInstruction: ASSEMBLED_PROMPT,
    });

    queueGoogleStream([
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'Response 1' }],
            },
          },
        ],
      },
    ]);

    // First call
    const chunks1: unknown[] = [];
    for await (const chunk of provider1.generateChatCompletion(options1)) {
      chunks1.push(chunk);
    }

    // Verify first call transported the agent-assembled instruction verbatim
    expect(googleGenAIState.streamCalls.length).toBe(1);
    expect(googleGenAIState.streamCalls[0].request.systemInstruction).toBe(
      ASSEMBLED_PROMPT,
    );

    // Simulate profile switch - create new provider instance with different auth
    // but same config (which should still have userMemory)
    const provider2 = new GeminiProvider(
      'different-api-key',
      undefined,
      config, // Same config instance with userMemory
    );

    const runtime2 = createProviderRuntimeContext({
      settingsService,
      config, // Same config
      runtimeId: 'test-runtime-switch-2',
    });

    const invocation2 = createRuntimeInvocationContext({
      runtime: runtime2,
      settings: settingsService,
      providerName: 'gemini',
      userMemory: TEST_USER_MEMORY, // Should come from config
      ephemeralsSnapshot: {},
    });

    const options2 = createProviderCallOptions({
      providerName: 'gemini',
      contents: [
        {
          speaker: 'human' as const,
          blocks: [
            { type: 'text' as const, text: 'Second request after switch' },
          ],
        },
      ],
      resolved: {
        model: 'gemini-2.5-pro',
      },
      runtime: runtime2,
      invocation: invocation2,
      userMemory: TEST_USER_MEMORY,
      systemInstruction: ASSEMBLED_PROMPT,
    });

    queueGoogleStream([
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'Response 2' }],
            },
          },
        ],
      },
    ]);

    // Second call after "profile switch"
    const chunks2: unknown[] = [];
    for await (const chunk of provider2.generateChatCompletion(options2)) {
      chunks2.push(chunk);
    }

    // Issue #409: the agent-assembled instruction (which carries user memory)
    // must NOT be lost across a profile switch. The second request must carry
    // the identical instruction verbatim.
    expect(googleGenAIState.streamCalls.length).toBe(2);
    const request2 = googleGenAIState.streamCalls[1].request;
    expect(request2).toHaveProperty('systemInstruction');
    expect(request2.systemInstruction).toBe(ASSEMBLED_PROMPT);
  });
});
