/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  writeResponseLog,
  logRequestEntry,
} from './conversationResponseLogger.js';
import type { ConversationDataRedactor } from './ConfigBasedRedactor.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

vi.mock('./telemetryEmitter.js', () => ({
  writeConversationLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./conversationLogger.js', () => ({
  logConversationRequestEntry: vi.fn().mockResolvedValue(undefined),
}));

import { writeConversationLog } from './telemetryEmitter.js';
import { logConversationRequestEntry } from './conversationLogger.js';

const mockConfig = {
  getConversationLoggingEnabled: () => true,
  getConversationLogPath: () => '/tmp/test-log',
  getRedactionConfig: () => ({}),
} as unknown as Parameters<typeof writeResponseLog>[0];

function createDebug() {
  const calls: string[] = [];
  return {
    log: vi.fn((fn: () => string) => void calls.push(fn())),
    warn: vi.fn((fn: () => string) => void calls.push(fn())),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    _calls: calls,
  };
}

describe('writeResponseLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a response log with unredacted content when no redactor', async () => {
    const debug = createDebug();
    await writeResponseLog(
      mockConfig,
      'hello world',
      'prompt-1',
      100,
      true,
      undefined,
      {
        providerName: 'test-provider',
        conversationId: 'conv-1',
        turnNumber: 1,
        defaultModelName: 'model-1',
        generatePromptId: () => 'generated-prompt',
        redactor: null,
        debug: debug as unknown as Parameters<
          typeof writeResponseLog
        >[6]['debug'],
      },
    );

    expect(writeConversationLog).toHaveBeenCalledWith(
      mockConfig,
      'hello world',
      'prompt-1',
      100,
      true,
      undefined,
      expect.objectContaining({ providerName: 'test-provider' }),
    );
  });

  it('applies redactor to content when redactor is provided', async () => {
    const debug = createDebug();
    const redactor: ConversationDataRedactor = {
      redactMessage: vi.fn(),
      redactResponseContent: vi.fn(() => 'REDACTED'),
      redactToolCall: vi.fn(),
    };
    await writeResponseLog(
      mockConfig,
      'secret data',
      'prompt-2',
      200,
      false,
      new Error('fail'),
      {
        providerName: 'test-provider',
        conversationId: 'conv-1',
        turnNumber: 1,
        defaultModelName: 'model-1',
        generatePromptId: () => 'gen',
        redactor,
        debug: debug as unknown as Parameters<
          typeof writeResponseLog
        >[6]['debug'],
      },
    );

    expect(redactor.redactResponseContent).toHaveBeenCalledWith(
      'secret data',
      'test-provider',
    );
    expect(writeConversationLog).toHaveBeenCalledWith(
      mockConfig,
      'REDACTED',
      'prompt-2',
      200,
      false,
      expect.any(Error),
      expect.any(Object),
    );
  });

  it('handles empty/null content without throwing', async () => {
    const debug = createDebug();
    await writeResponseLog(mockConfig, '', 'prompt-3', 0, true, undefined, {
      providerName: 'test-provider',
      conversationId: 'conv-1',
      turnNumber: 0,
      defaultModelName: 'model-1',
      generatePromptId: () => 'gen',
      redactor: null,
      debug: debug as unknown as Parameters<
        typeof writeResponseLog
      >[6]['debug'],
    });

    expect(writeConversationLog).toHaveBeenCalledWith(
      mockConfig,
      '',
      'prompt-3',
      0,
      true,
      undefined,
      expect.any(Object),
    );
  });

  it('swallows errors from writeConversationLog (fail-open)', async () => {
    const debug = createDebug();
    vi.mocked(writeConversationLog).mockRejectedValueOnce(
      new Error('disk write failed'),
    );

    // Should NOT throw
    await expect(
      writeResponseLog(
        mockConfig,
        'content',
        'prompt-4',
        100,
        true,
        undefined,
        {
          providerName: 'test-provider',
          conversationId: 'conv-1',
          turnNumber: 1,
          defaultModelName: 'model-1',
          generatePromptId: () => 'gen',
          redactor: null,
          debug: debug as unknown as Parameters<
            typeof writeResponseLog
          >[6]['debug'],
        },
      ),
    ).resolves.toBeUndefined();

    expect(debug.warn).toHaveBeenCalled();
  });
});

describe('logRequestEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a conversation request entry', async () => {
    const debug = createDebug();
    const content: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ];
    await logRequestEntry(mockConfig, content, undefined, 'prompt-1', {
      providerName: 'test-provider',
      conversationId: 'conv-1',
      turnNumber: 1,
      defaultModelName: 'model-1',
      generatePromptId: () => 'gen',
      redactor: null,
      debug: debug as unknown as Parameters<typeof logRequestEntry>[4]['debug'],
    });

    expect(logConversationRequestEntry).toHaveBeenCalledWith(
      mockConfig,
      content,
      undefined,
      'prompt-1',
      expect.objectContaining({ providerName: 'test-provider' }),
    );
  });

  it('swallows errors from logConversationRequestEntry (fail-open)', async () => {
    const debug = createDebug();
    vi.mocked(logConversationRequestEntry).mockRejectedValueOnce(
      new Error('request log failed'),
    );

    await expect(
      logRequestEntry(mockConfig, [], undefined, 'prompt-2', {
        providerName: 'test-provider',
        conversationId: 'conv-1',
        turnNumber: 1,
        defaultModelName: 'model-1',
        generatePromptId: () => 'gen',
        redactor: null,
        debug: debug as unknown as Parameters<
          typeof logRequestEntry
        >[4]['debug'],
      }),
    ).resolves.toBeUndefined();

    expect(debug.warn).toHaveBeenCalled();
  });
});
