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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '../../../runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '../../../test-utils/runtime.js';
import type { Config } from '../../../config/config.js';
import { GeminiProvider } from '../GeminiProvider.js';
import { createProviderCallOptions } from '../../../test-utils/providerCallOptions.js';

// Track what system prompts were generated
let capturedSystemPrompts: string[] = [];

vi.mock('../../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async (userMemory: string) => {
    const prompt = userMemory ? `SYSTEM[${userMemory}]` : 'SYSTEM[empty]';
    capturedSystemPrompts.push(prompt);
    return prompt;
  }),
}));

const googleGenAIState = {
  instances: [] as Array<{ options: Record<string, unknown> }>,
  streamCalls: [] as Array<{ request: Record<string, unknown> }>,
  nonStreamCalls: [] as Array<{ request: Record<string, unknown> }>,
  streamPlans: [] as Array<Array<Record<string, unknown>>>,
};

vi.mock('@google/genai', () => {
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

  const Type = { OBJECT: 'object' };

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

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSystemPrompts = [];
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

    // Verify system prompt was called with userMemory
    expect(capturedSystemPrompts.length).toBeGreaterThan(0);
    expect(capturedSystemPrompts[0]).toContain(TEST_USER_MEMORY);
    expect(capturedSystemPrompts[0]).not.toBe('SYSTEM[empty]');

    // Verify the request included systemInstruction
    expect(googleGenAIState.streamCalls.length).toBe(1);
    const request = googleGenAIState.streamCalls[0].request;
    expect(request).toHaveProperty('systemInstruction');
    expect(request.systemInstruction).toContain(TEST_USER_MEMORY);
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

    // Verify first call had userMemory
    expect(capturedSystemPrompts.length).toBe(1);
    expect(capturedSystemPrompts[0]).toContain(TEST_USER_MEMORY);

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

    // Verify second call ALSO had userMemory (this is the bug - it would be empty)
    expect(capturedSystemPrompts.length).toBe(2);
    expect(capturedSystemPrompts[1]).toContain(TEST_USER_MEMORY);
    expect(capturedSystemPrompts[1]).not.toBe('SYSTEM[empty]');

    // Verify both requests included systemInstruction with userMemory
    expect(googleGenAIState.streamCalls.length).toBe(2);
    const request2 = googleGenAIState.streamCalls[1].request;
    expect(request2).toHaveProperty('systemInstruction');
    expect(request2.systemInstruction).toContain(TEST_USER_MEMORY);
  });
});
