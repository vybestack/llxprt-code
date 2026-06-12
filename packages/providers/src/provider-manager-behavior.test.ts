/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ProviderManager and FakeProvider Behavioral Tests (P10)
 *
 * These tests verify that ProviderManager and FakeProvider continue to exhibit
 * their expected behavior. They import from core (current location) and will
 * be updated to import from providers (post-migration location) in P11.
 *
 * Behavioral focus:
 * - ProviderManager registration and switching
 * - FakeProvider response replay
 * - Provider error hierarchy
 * - LoadBalancingProvider creation
 *
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// P11: provider implementations and provider-specific errors are imported
// from the providers package. Core-only services remain imported from core.
import {
  ProviderManager,
  FakeProvider,
  RateLimitError,
  QuotaError,
  AuthenticationError,
  ServerError,
  NetworkError,
  ClientError,
  LoadBalancerFailoverError,
  AllBucketsExhaustedError,
  AuthenticationRequiredError,
  MissingProviderRuntimeError,
  type BucketFailureReason,
} from '@vybestack/llxprt-code-providers';

// Import SettingsService for proper ProviderManager construction
import { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Helper: create a minimal runtime config for ProviderManager tests.
 * Uses real SettingsService and a lightweight config stub, matching
 * the pattern used by existing core provider tests.
 */
function createTestConfig(settingsService: SettingsService) {
  return {
    getConversationLoggingEnabled: () => false,
    setConversationLoggingEnabled: () => {},
    getTelemetryLogPromptsEnabled: () => false,
    setTelemetryLogPromptsEnabled: () => {},
    getUsageStatisticsEnabled: () => false,
    setUsageStatisticsEnabled: () => {},
    getDebugMode: () => false,
    setDebugMode: () => {},
    isInteractive: () => false,
    getSessionId: () => 'test-session',
    setSessionId: () => {},
    getFlashFallbackMode: () => 'off' as const,
    setFlashFallbackMode: () => {},
    getProvider: () => 'fake',
    setProvider: () => {},
    getSettingsService: () => settingsService,
    getProviderSettings: () => ({}) as Record<string, unknown>,
    setProviderSettings: () => {},
    getProviderConfig: () => ({}) as Record<string, unknown>,
    setProviderConfig: () => {},
    resetProvider: () => {},
    resetProviderSettings: () => {},
    resetProviderConfig: () => {},
    getActiveWorkspace: () => undefined as string | undefined,
    setActiveWorkspace: () => {},
    clearActiveWorkspace: () => {},
    getExtensionConfig: () => ({}),
    setExtensionConfig: () => {},
    getFeatures: () => ({}),
    setFeatures: () => {},
    getRedactionConfig: () => ({ replacements: [] }),
    setProviderManager: () => {},
    getEphemeralSettings: () => ({}),
    getModel: () => 'fake-model',
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test stub
}

/**
 * Helper: create a JSONL fixture file for FakeProvider.
 */
function writeJsonlFixture(
  dir: string,
  name: string,
  chunks: Array<{
    speaker: string;
    blocks: Array<{ type: string; text: string }>;
  }>,
): string {
  const filePath = join(dir, name);
  const lines = chunks.map((c) => JSON.stringify({ chunks: [c] }));
  writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Behavioral tests for ProviderManager.
 * Proves that provider registration, switching, and listing behave correctly.
 * These tests must continue to pass identically after P11 migration.
 */
describe('ProviderManager behavioral tests', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ProviderManager can register a FakeProvider and list it.
   */
  it('registers a FakeProvider and lists it', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pm-behavior-'));
    try {
      const filePath = writeJsonlFixture(tempDir, 'response.jsonl', [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'test' }] },
      ]);
      const provider = new FakeProvider(filePath);
      const settingsService = new SettingsService();
      const config = createTestConfig(settingsService);
      const manager = new ProviderManager({ settingsService, config });
      settingsService.set('activeProvider', 'fake');
      settingsService.setProviderSetting('fake', 'auth-key', 'test-key');
      manager.registerProvider(provider);
      const providers = manager.listProviders();
      expect(providers).toContain('fake');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ProviderManager can switch between providers.
   */
  it('switches active provider between registered providers', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pm-switch-'));
    try {
      const filePath = writeJsonlFixture(tempDir, 'response.jsonl', [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'hello' }] },
      ]);
      const provider = new FakeProvider(filePath);
      const settingsService = new SettingsService();
      const config = createTestConfig(settingsService);
      const manager = new ProviderManager({ settingsService, config });
      settingsService.setProviderSetting('fake', 'auth-key', 'test-key');
      manager.registerProvider(provider);
      manager.setActiveProvider('fake');
      expect(manager.getActiveProviderName()).toBe('fake');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ProviderManager.hasActiveProvider returns false for fresh instance.
   */
  it('hasActiveProvider returns false for fresh instance', () => {
    const settingsService = new SettingsService();
    const config = createTestConfig(settingsService);
    const manager = new ProviderManager({ settingsService, config });
    expect(manager.hasActiveProvider()).toBe(false);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * ProviderManager.clearActiveProvider removes the active provider.
   */
  it('clears active provider', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pm-clear-'));
    try {
      const filePath = writeJsonlFixture(tempDir, 'response.jsonl', [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'x' }] },
      ]);
      const provider = new FakeProvider(filePath);
      const settingsService = new SettingsService();
      const config = createTestConfig(settingsService);
      const manager = new ProviderManager({ settingsService, config });
      settingsService.setProviderSetting('fake', 'auth-key', 'test-key');
      manager.registerProvider(provider);
      manager.setActiveProvider('fake');
      expect(manager.hasActiveProvider()).toBe(true);
      manager.clearActiveProvider();
      expect(manager.hasActiveProvider()).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Behavioral tests for FakeProvider.
 * Proves that FakeProvider replays JSONL fixtures deterministically,
 * which is critical for integration testing after migration.
 */
describe('FakeProvider behavioral tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'fake-provider-beh-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * FakeProvider replays a single turn from JSONL fixture.
   */
  it('replays a single response turn from JSONL fixture', async () => {
    const filePath = join(tempDir, 'single.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'hello' }] }],
      }),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);
    const chunks: string[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      const textBlock = chunk.blocks.find(
        (b: { type: string }) => b.type === 'text',
      );
      if (textBlock != null && 'text' in textBlock)
        chunks.push((textBlock as { text: string }).text);
    }
    expect(chunks.join('')).toBe('hello');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * FakeProvider replays multiple turns in order.
   */
  it('replays multiple turns in order', async () => {
    const filePath = join(tempDir, 'multi.jsonl');
    writeFileSync(
      filePath,
      [
        JSON.stringify({
          chunks: [
            { speaker: 'ai', blocks: [{ type: 'text', text: 'first' }] },
          ],
        }),
        JSON.stringify({
          chunks: [
            { speaker: 'ai', blocks: [{ type: 'text', text: 'second' }] },
          ],
        }),
      ].join('\n'),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);

    // First call
    const firstTurn: string[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      const textBlock = chunk.blocks.find(
        (b: { type: string }) => b.type === 'text',
      );
      if (textBlock != null && 'text' in textBlock)
        firstTurn.push((textBlock as { text: string }).text);
    }
    expect(firstTurn.join('')).toBe('first');

    // Second call
    const secondTurn: string[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      const textBlock = chunk.blocks.find(
        (b: { type: string }) => b.type === 'text',
      );
      if (textBlock != null && 'text' in textBlock)
        secondTurn.push((textBlock as { text: string }).text);
    }
    expect(secondTurn.join('')).toBe('second');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   */
  it('throws when called more times than available turns', async () => {
    const filePath = join(tempDir, 'exhausted.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'only' }] }],
      }),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);

    // First call succeeds
    for await (const _chunk of provider.generateChatCompletion([])) {
      // consume
    }

    // Second call should throw
    await expect(
      (async () => {
        for await (const _chunk of provider.generateChatCompletion([])) {
          // should not reach here
        }
      })(),
    ).rejects.toThrow(/no more canned responses/i);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * FakeProvider.name is 'fake'
   */
  it('has name property "fake"', () => {
    const filePath = writeJsonlFixture(tempDir, 'name.jsonl', [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'test' }] },
    ]);
    const provider = new FakeProvider(filePath);
    expect(provider.name).toBe('fake');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * FakeProvider returns deterministic auth token
   */
  it('returns fake auth token', async () => {
    const filePath = writeJsonlFixture(tempDir, 'auth.jsonl', [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'test' }] },
    ]);
    const provider = new FakeProvider(filePath);
    const token = await provider.getAuthToken();
    expect(token).toBe('fake-auth-token');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * FakeProvider returns models with correct structure
   */
  it('returns models with expected structure', async () => {
    const filePath = writeJsonlFixture(tempDir, 'models.jsonl', [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'test' }] },
    ]);
    const provider = new FakeProvider(filePath);
    const models = await provider.getModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('fake-model');
    expect(models[0].provider).toBe('fake');
  });
});

/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 *
 * Behavioral tests for provider error hierarchy.
 * Proves that the error classes have the correct properties and inheritance.
 * These must continue to work identically after P11 migration.
 */
describe('Provider error hierarchy behavioral tests', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RateLimitError has correct category and retry properties
   */
  it('RateLimitError has rate_limit category and is retryable', () => {
    const error = new RateLimitError('rate limited', { status: 429 });
    expect(error.category).toBe('rate_limit');
    expect(error.isRetryable).toBe(true);
    expect(error.shouldFailover).toBe(true);
    expect(error.status).toBe(429);
    expect(error).toBeInstanceOf(Error);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   */
  it('QuotaError has quota category and triggers immediate failover', () => {
    const error = new QuotaError('quota exceeded');
    expect(error.category).toBe('quota');
    expect(error.isRetryable).toBe(true);
    expect(error.shouldFailover).toBe(true);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   */
  it('AuthenticationError has authentication category', () => {
    const error = new AuthenticationError('auth failed', { status: 401 });
    expect(error.category).toBe('authentication');
    expect(error.isRetryable).toBe(true);
    expect(error.shouldFailover).toBe(true);
    expect(error.status).toBe(401);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   */
  it('ServerError is retryable but does not trigger failover', () => {
    const error = new ServerError('server error', { status: 500 });
    expect(error.category).toBe('server_error');
    expect(error.isRetryable).toBe(true);
    expect(error.shouldFailover).toBe(false);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   */
  it('NetworkError is retryable but does not trigger failover', () => {
    const error = new NetworkError('connection reset');
    expect(error.category).toBe('network');
    expect(error.isRetryable).toBe(true);
    expect(error.shouldFailover).toBe(false);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   */
  it('ClientError is not retryable and does not trigger failover', () => {
    const error = new ClientError('bad request', { status: 400 });
    expect(error.category).toBe('client_error');
    expect(error.isRetryable).toBe(false);
    expect(error.shouldFailover).toBe(false);
    expect(error.status).toBe(400);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * MissingProviderRuntimeError preserves key diagnostic properties
   */
  it('MissingProviderRuntimeError has providerKey and missingFields', () => {
    const error = new MissingProviderRuntimeError({
      providerKey: 'test-provider',
      missingFields: ['authToken', 'baseURL'],
    });
    expect(error.providerKey).toBe('test-provider');
    expect(error.missingFields).toStrictEqual(['authToken', 'baseURL']);
    expect(error).toBeInstanceOf(Error);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * LoadBalancerFailoverError aggregates backend failures
   */
  it('LoadBalancerFailoverError aggregates failures', () => {
    const failures = [
      { profile: 'backend-1', error: new Error('timeout') },
      { profile: 'backend-2', error: new Error('rate limit') },
    ];
    const error = new LoadBalancerFailoverError('lb-test', failures);
    expect(error.profileName).toBe('lb-test');
    expect(error.failures).toHaveLength(2);
    expect(error.failures[0].profile).toBe('backend-1');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AllBucketsExhaustedError preserves bucket failure reasons
   */
  it('AllBucketsExhaustedError preserves failure reasons', () => {
    const reasons: Record<string, BucketFailureReason> = {
      bucket1: 'quota-exhausted',
      bucket2: 'expired-refresh-failed',
    };
    const error = new AllBucketsExhaustedError(
      'test-provider',
      ['bucket1', 'bucket2'],
      new Error('last error'),
      reasons,
    );
    expect(error.attemptedBuckets).toStrictEqual(['bucket1', 'bucket2']);
    expect(error.bucketFailureReasons).toStrictEqual(reasons);
    expect(error.lastError.message).toBe('last error');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * AuthenticationRequiredError preserves authMode and requiredAuth
   */
  it('AuthenticationRequiredError preserves authMode', () => {
    const error = new AuthenticationRequiredError(
      'API key required',
      'api-key',
      ['OPENAI_API_KEY'],
    );
    expect(error.authMode).toBe('api-key');
    expect(error.requiredAuth).toStrictEqual(['OPENAI_API_KEY']);
    expect(error).toBeInstanceOf(Error);
  });
});
