/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for invokeServerToolWithLogging covering:
 * 1. Successful tool calls return their result after optional logging
 * 2. Failed tool calls re-throw the original error even if logging throws
 * 3. The fail-open pattern must not swallow provider errors
 * 4. Logging is skipped when conversation logging is disabled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeServerToolWithLogging } from './serverToolLogger.js';
import type { ServerToolLogContext } from './serverToolLogger.js';
import type { IProvider } from '../IProvider.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import * as conversationLogger from './conversationLogger.js';

function makeLogCtx(debug: {
  warn: (cb: () => string) => void;
}): ServerToolLogContext {
  return {
    providerName: 'test-provider',
    conversationId: 'conv-1',
    turnNumber: 0,
    generatePromptId() {
      return 'prompt-1';
    },
    redactor: null,
    debug: debug as unknown as ServerToolLogContext['debug'],
  };
}

function makeProvider(invoke: IProvider['invokeServerTool']): IProvider {
  return {
    name: 'test-provider',
    getModels: async () => [],
    async *generateChatCompletion() {},
    getServerTools: () => [],
    invokeServerTool: invoke,
  } as unknown as IProvider;
}

describe('invokeServerToolWithLogging', () => {
  let settingsService: SettingsService;
  let config: ReturnType<typeof createRuntimeConfigStub>;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
  });

  it('returns the provider result on success', async () => {
    const provider = makeProvider(async () => ({
      ok: true,
    }));
    const ctx = makeLogCtx({ warn: vi.fn() });

    const result = await invokeServerToolWithLogging(
      provider,
      'get_status',
      {},
      config,
      ctx,
    );
    expect(result).toStrictEqual({ ok: true });
  });

  it('re-throws the original provider error on failure', async () => {
    const providerError = new Error('Tool execution failed');
    const provider = makeProvider(async () => {
      throw providerError;
    });
    const ctx = makeLogCtx({ warn: vi.fn() });

    await expect(
      invokeServerToolWithLogging(provider, 'failing_tool', {}, config, ctx),
    ).rejects.toBe(providerError);
  });

  it('fail-open: provider error is not swallowed when logging throws', async () => {
    const providerError = new Error('Provider boom');
    const provider = makeProvider(async () => {
      throw providerError;
    });
    const warnFn = vi.fn();
    const ctx = makeLogCtx({ warn: warnFn });

    // Enable conversation logging so the error-path logging branch is
    // actually exercised.
    vi.spyOn(
      config as unknown as { getConversationLoggingEnabled: () => boolean },
      'getConversationLoggingEnabled',
    ).mockReturnValue(true);
    // Make the logging dependency reject to verify fail-open.
    vi.spyOn(conversationLogger, 'logToolCallEntry').mockRejectedValue(
      new Error('Logging infrastructure failed'),
    );

    await expect(
      invokeServerToolWithLogging(provider, 'tool', {}, config, ctx),
    ).rejects.toBe(providerError);
    // The provider error should be re-thrown, not swallowed
    // Verify the fail-open warning path was exercised
    expect(warnFn).toHaveBeenCalled();
  });

  it('fail-open: does not swallow the provider result when logging is disabled', async () => {
    const provider = makeProvider(async () => 'result');
    const ctx = makeLogCtx({ warn: vi.fn() });

    const result = await invokeServerToolWithLogging(
      provider,
      'tool',
      {},
      undefined, // no config → logging disabled
      ctx,
    );
    expect(result).toBe('result');
  });
});
