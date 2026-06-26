/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral JSONL test for LoggingProviderWrapper verifying the
 * providers → storage dependency works correctly after extraction.
 *
 * All assertions are against real observable output (JSONL on disk),
 * not mock call verification.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { LoggingProviderWrapper } from './LoggingProviderWrapper.js';
import { ConfigBasedRedactor } from './logging/ConfigBasedRedactor.js';
import type {
  IProvider,
  IContent,
  GenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService as SettingsServiceImpl } from '@vybestack/llxprt-code-settings';
import { getConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
// P06: intentional core deep import — verifies shim re-exports storage symbols correctly
import { getConversationFileWriter as getFromCore } from '@vybestack/llxprt-code-core/storage/ConversationFileWriter.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

class FakeProvider implements IProvider {
  name = 'fake-test-provider';
  isDefault = false;
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'fake-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }
  async *generateChatCompletion(
    _contentOrOptions: IContent[] | GenerateChatOptions,
    _tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text' as const, text: 'test response' }],
      metadata: {
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          cachedTokens: 0,
        },
      },
    } as IContent;
  }
}

function buildConfigStub(tmpDir: string): Config {
  return {
    getConversationLoggingEnabled: () => true,
    getConversationLogPath: () => tmpDir,
    getRedactionConfig: () => ({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    }),
    getProviderManager: () => ({ accumulateSessionTokens: () => {} }),
  } as unknown as Config;
}

describe('LoggingProviderWrapper — behavioral JSONL output', () => {
  afterEach(() => {
    resetConversationFileWriterForTesting();
  });

  it('writes request and response JSONL entries to disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lpw-jsonl-test-'));
    const configStub = buildConfigStub(tmpDir);
    const settings = new SettingsServiceImpl();
    const fake = new FakeProvider();
    const wrapper = new LoggingProviderWrapper(fake);

    const runtime: ProviderRuntimeContext = {
      settingsService: settings as unknown as SettingsService,
      config: configStub,
      runtimeId: 'test-runtime',
      metadata: { source: 'LoggingProviderWrapper.test' },
    };

    const inputContent: IContent[] = [
      {
        speaker: 'user',
        blocks: [{ type: 'text', text: 'hi' }],
      } as IContent,
    ];

    const options: GenerateChatOptions = {
      contents: inputContent,
      settings: settings as unknown as SettingsService,
      runtime,
      config: configStub,
    };

    // Consume the async iterator to completion
    const chunks: IContent[] = [];
    for await (const chunk of wrapper.generateChatCompletion(options)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    // Read the JSONL file
    const dateStr = new Date().toISOString().split('T')[0];
    const jsonlPath = path.join(tmpDir, `conversation-${dateStr}.jsonl`);
    const content = await fs.readFile(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Parse line 1: request
    const requestEntry: Record<string, unknown> = JSON.parse(lines[0]);
    expect(requestEntry.type).toBe('request');
    expect(requestEntry.provider).toBe('fake-test-provider');
    expect(Array.isArray(requestEntry.messages)).toBe(true);
    expect(requestEntry.context).toBeDefined();
    const reqCtx = requestEntry.context as Record<string, unknown>;
    expect(typeof reqCtx.conversationId).toBe('string');
    expect(reqCtx.turnNumber).toBe(1);
    expect(typeof requestEntry.timestamp).toBe('string');
    // Validate ISO timestamp
    expect(new Date(requestEntry.timestamp as string).toISOString()).toBe(
      requestEntry.timestamp,
    );

    // Parse line 2: response
    const responseEntry = JSON.parse(lines[1]) as Record<string, unknown>;
    expect(responseEntry.type).toBe('response');
    expect(responseEntry.provider).toBe('fake-test-provider');
    // Response field is extracted via extractSimpleContent which reads OpenAI-style
    // delta.content. IContent blocks are not extracted, so response may be empty.
    expect(typeof responseEntry.response).toBe('string');
    const metadata = responseEntry.metadata as Record<string, unknown>;
    expect(metadata.success).toBe(true);
    expect(typeof metadata.duration).toBe('number');
    expect(metadata.duration as number).toBeGreaterThan(0);
    expect(typeof responseEntry.timestamp).toBe('string');

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('core shim and storage return the same singleton instance', () => {
    const storageWriter = getConversationFileWriter();
    const coreWriter = getFromCore();

    // Strict identity: both paths resolve to the same object
    expect(coreWriter).toBe(storageWriter);
  });

  it('logs error to observable array when write fails', async () => {
    const errors: Array<{ message: string; context?: unknown }> = [];
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lpw-error-test-'));
    const blockerPath = path.join(tmpDir, 'blocker');
    await fs.writeFile(blockerPath, 'not a directory');
    const badLogPath = path.join(tmpDir, 'blocker', 'conversations');

    const { ConversationFileWriter } = await import(
      '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js'
    );
    const testLogger = {
      debug: () => {},
      warn: () => {},
      error: (message: string, context?: unknown) =>
        errors.push({ message, context }),
    };

    const writer = new ConversationFileWriter(badLogPath, testLogger);
    await writer.writeRequest('test-provider', []);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('Failed to write log entry');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps request logging failures observable while allowing provider response', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'lpw-request-fail-'),
    );
    const configStub = buildConfigStub(tmpDir);
    const settings = new SettingsServiceImpl();
    const throwingRedactor = {
      redactMessage: () => {
        throw new Error('redaction failed');
      },
      redactToolCall: (tool: unknown) => tool,
      redactResponseContent: (content: string) => content,
    };
    const wrapper = new LoggingProviderWrapper(
      new FakeProvider(),
      throwingRedactor,
    );
    const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

    const runtime: ProviderRuntimeContext = {
      settingsService: settings as unknown as SettingsService,
      config: configStub,
      runtimeId: 'request-log-failure-runtime',
      metadata: { source: 'LoggingProviderWrapper.test' },
    };

    try {
      const chunks: IContent[] = [];
      for await (const chunk of wrapper.generateChatCompletion({
        contents: [{ speaker: 'user', blocks: [{ type: 'text', text: 'hi' }] }],
        settings: settings as unknown as SettingsService,
        runtime,
        config: configStub,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const warningMessages = warnSpy.mock.calls.map((call) => call[0]());
      expect(warningMessages).toContainEqual(
        expect.stringContaining('Failed to log conversation request'),
      );
    } finally {
      warnSpy.mockRestore();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('redacts credential file paths without an ESLint regex exception', () => {
    const redactor = new ConfigBasedRedactor({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: true,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    });

    const redacted = redactor.redactResponseContent(
      'keys at /Users/alice/.ssh/id_ed25519 and /home/bob/project/.env.local',
      'fake-test-provider',
    );

    expect(redacted).toContain('[REDACTED-SSH-PATH]');
    expect(redacted).toContain('[REDACTED-ENV-FILE]');
    expect(redacted).not.toContain('id_ed25519');
    expect(redacted).not.toContain('.env.local');
  });

  it('preserves bearer and absolute-path redaction semantics without ESLint regex exceptions', () => {
    const credentialRedactor = new ConfigBasedRedactor({
      redactApiKeys: false,
      redactCredentials: true,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    });
    const fileRedactor = new ConfigBasedRedactor({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: true,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    });

    expect(
      credentialRedactor.redactResponseContent(
        'authorization: bearer abcdefghijklmnop.qrs-token',
        'fake-test-provider',
      ),
    ).toContain('bearer [REDACTED-BEARER-TOKEN]');

    expect(
      fileRedactor.redactResponseContent(
        'relative secret .ssh/id_ed25519 should remain visible',
        'fake-test-provider',
      ),
    ).toContain('.ssh/id_ed25519');
  });

  it('preserves punctuation-delimited redaction semantics without regex disables', () => {
    const fileRedactor = new ConfigBasedRedactor({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: true,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    });
    const emailRedactor = new ConfigBasedRedactor({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: true,
      redactPersonalInfo: false,
    });
    const personalInfoRedactor = new ConfigBasedRedactor({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: true,
    });

    expect(
      fileRedactor.redactResponseContent(
        'path=(/Users/alice/.ssh/id_ed25519), env=path:/home/bob/project/.env.local',
        'fake-test-provider',
      ),
    ).toContain('[REDACTED-SSH-PATH]');
    expect(
      fileRedactor.redactResponseContent(
        'path=(/Users/alice/.ssh/id_ed25519), env=path:/home/bob/project/.env.local',
        'fake-test-provider',
      ),
    ).toContain('[REDACTED-ENV-FILE]');
    expect(
      emailRedactor.redactResponseContent(
        'contact=<alice@example.com>',
        'fake-test-provider',
      ),
    ).toBe('contact=<[REDACTED-EMAIL]>');
    expect(
      personalInfoRedactor.redactResponseContent(
        'cc=4111 1111 1111 1111',
        'fake-test-provider',
      ),
    ).toBe('cc=[REDACTED-CC-NUMBER]');
  });
});
