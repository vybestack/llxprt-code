import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConfigSession } from './configSession';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('ConfigSession', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nui-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createConfigSession', () => {
    it('should create Config with minimal required parameters', () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        workingDir: tempDir,
      });

      expect(session.config).toBeDefined();
      expect(session.config.getModel()).toBe('gemini-2.5-flash');
    });

    it('should apply provider setting', () => {
      const session = createConfigSession({
        model: 'gpt-4',
        provider: 'openai',
        workingDir: tempDir,
      });

      expect(session.config.getProvider()).toBe('openai');
    });

    it('should disable telemetry by default', () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        workingDir: tempDir,
      });

      expect(session.config.getTelemetryEnabled()).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should make GeminiClient available after initialization', async () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        workingDir: tempDir,
      });

      await session.initialize();

      expect(session.getClient()).toBeDefined();
    });

    it('should register tools in ToolRegistry', async () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        workingDir: tempDir,
      });

      await session.initialize();

      const registry = session.config.getToolRegistry();
      const tools = registry.getFunctionDeclarations();

      expect(tools.length).toBeGreaterThan(0);
    });

    it('should be idempotent', async () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        workingDir: tempDir,
      });

      await session.initialize();
      await session.initialize();

      expect(session.getClient()).toBeDefined();
    });
  });

  describe('getClient', () => {
    it('should throw if called before initialize', () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        workingDir: tempDir,
      });

      expect(() => session.getClient()).toThrow(
        'ConfigSession not initialized. Call initialize() first.',
      );
    });
  });

  describe('provider initialization', () => {
    // Provider initialization is slow on Windows CI due to ProviderManager setup
    it(
      'should initialize with OpenAI provider without error',
      { timeout: 15000 },
      async () => {
        const session = createConfigSession({
          model: 'gpt-4',
          provider: 'openai',
          'base-url': 'https://api.openai.com/v1',
          apiKey: 'test-key',
          workingDir: tempDir,
        });

        // This should NOT throw - the test ensures the auth flow works
        await session.initialize();

        expect(session.getClient()).toBeDefined();
      },
    );

    it(
      'should initialize with Anthropic provider without error',
      { timeout: 15000 },
      async () => {
        const session = createConfigSession({
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          'base-url': 'https://api.anthropic.com',
          apiKey: 'test-key',
          workingDir: tempDir,
        });

        // This should NOT throw - the test ensures the auth flow works
        await session.initialize();

        expect(session.getClient()).toBeDefined();
      },
    );

    it('should initialize with Gemini provider without error', async () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        provider: 'gemini',
        apiKey: 'test-key',
        workingDir: tempDir,
      });

      await session.initialize();

      expect(session.getClient()).toBeDefined();
    });

    it(
      'should set up ProviderManager for OpenAI provider',
      { timeout: 15000 },
      async () => {
        const session = createConfigSession({
          model: 'gpt-4',
          provider: 'openai',
          'base-url': 'https://api.openai.com/v1',
          apiKey: 'test-key',
          workingDir: tempDir,
        });

        await session.initialize();

        // ProviderManager should be set for non-gemini providers
        const providerManager = session.config.getProviderManager();
        expect(providerManager).toBeDefined();
      },
    );

    it('should NOT set up ProviderManager for Gemini provider', async () => {
      const session = createConfigSession({
        model: 'gemini-2.5-flash',
        provider: 'gemini',
        apiKey: 'test-key',
        workingDir: tempDir,
      });

      await session.initialize();

      // ProviderManager should NOT be set for Gemini
      const providerManager = session.config.getProviderManager();
      expect(providerManager).toBeUndefined();
    });
  });
});
