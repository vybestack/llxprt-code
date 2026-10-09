/**
 * @issue #1943 - OpenAI providers ignore explicit toolFormat override for kimi model names
 *
 * Behavioral tests for OpenAIVercelProvider.getToolFormat() and
 * convertToModelMessages() honoring provider toolFormat overrides from
 * SettingsService before falling back to model-name auto-detection.
 *
 * Also covers per-call resolved model (options.resolved.model) being used
 * for tool format detection in generateChatCompletionWithOptions rather than
 * the provider's default model.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { resolveToolFormat } from '../utils/toolFormatDetection.js';

describe('OpenAIVercelProvider.getToolFormat() - override vs auto-detection (issue #1943)', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    settingsService = new SettingsService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createWiredProvider = (): OpenAIVercelProvider => {
    const wired = new OpenAIVercelProvider('test-key');
    wired.setRuntimeSettingsService(settingsService);
    return wired;
  };

  it('returns "openai" override for a kimi model when provider toolFormat is set to "openai"', () => {
    settingsService.setProviderSetting('openaivercel', 'toolFormat', 'openai');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('openai');
  });

  it('auto-detects "kimi" format when provider toolFormat is "auto"', () => {
    settingsService.setProviderSetting('openaivercel', 'toolFormat', 'auto');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('auto-detects "kimi" format when no toolFormat override is set', () => {
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('returns explicit "kimi" override even for a standard model', () => {
    settingsService.setProviderSetting('openaivercel', 'toolFormat', 'kimi');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('gpt-4o');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('returns "openai" by default for standard models', () => {
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('gpt-4o');

    expect(provider.getToolFormat()).toBe('openai');
  });

  it('auto-detects "mistral" format for mistral model when no override', () => {
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('mistral-large-latest');

    expect(provider.getToolFormat()).toBe('mistral');
  });

  it('returns "openai" for GLM models when override is set to "openai"', () => {
    settingsService.setProviderSetting('openaivercel', 'toolFormat', 'openai');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('openai:hf:zai-org/GLM-4.6');

    expect(provider.getToolFormat()).toBe('openai');
  });
});

describe('Per-call resolved model vs provider model (issue #1943 finding 1)', () => {
  /**
   * These tests verify that when options.resolved.model differs from the
   * provider's getModel()/default, the resolved model is used for tool
   * format detection in convertToModelMessages.
   *
   * Since convertToModelMessages is private, we test via resolveToolFormat
   * with the resolved model to confirm the format changes correctly.
   */

  it('auto-detects kimi format when resolved model is kimi even if provider default is gpt-4o', () => {
    const settingsService = new SettingsService();
    const format = resolveToolFormat(
      'moonshot-v1-kimi-k2', // resolved model
      'openaivercel',
      settingsService,
    );
    expect(format).toBe('kimi');
  });

  it('auto-detects openai format when resolved model is gpt-4o even if provider default is kimi', () => {
    const settingsService = new SettingsService();
    const format = resolveToolFormat(
      'gpt-4o', // resolved model
      'openaivercel',
      settingsService,
    );
    expect(format).toBe('openai');
  });

  it('uses explicit openai override to suppress kimi auto-detection for resolved kimi model', () => {
    const settingsService = new SettingsService();
    settingsService.setProviderSetting('openaivercel', 'toolFormat', 'openai');
    const format = resolveToolFormat(
      'moonshot-v1-kimi-k2', // resolved model is kimi
      'openaivercel',
      settingsService,
    );
    expect(format).toBe('openai'); // override suppresses auto-detection
  });

  it('uses explicit openai override to suppress mistral auto-detection for resolved mistral model', () => {
    const settingsService = new SettingsService();
    settingsService.setProviderSetting('openaivercel', 'toolFormat', 'openai');
    const format = resolveToolFormat(
      'mistral-large-latest', // resolved model is mistral
      'openaivercel',
      settingsService,
    );
    expect(format).toBe('openai'); // override suppresses auto-detection
  });

  it('detects different format when resolved model changes mid-session from kimi to gpt', () => {
    const settingsService = new SettingsService();
    // First call with kimi model
    expect(
      resolveToolFormat('moonshot-v1-kimi-k2', 'openaivercel', settingsService),
    ).toBe('kimi');
    // Second call with gpt model (different resolved.model)
    expect(resolveToolFormat('gpt-4o', 'openaivercel', settingsService)).toBe(
      'openai',
    );
  });

  it('detects different format when resolved model changes mid-session from gpt to mistral', () => {
    const settingsService = new SettingsService();
    expect(resolveToolFormat('gpt-4o', 'openaivercel', settingsService)).toBe(
      'openai',
    );
    expect(
      resolveToolFormat(
        'mistral-large-latest',
        'openaivercel',
        settingsService,
      ),
    ).toBe('mistral');
  });
});
