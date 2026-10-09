/**
 * @issue #1943 - OpenAI providers ignore explicit toolFormat override for kimi model names
 *
 * Behavioral tests for OpenAIProvider.getToolFormat() honoring provider
 * toolFormat overrides from SettingsService before falling back to model-name
 * auto-detection.
 *
 * These tests verify that:
 * 1. When a toolFormat override is set (e.g. 'openai'), it is used even for kimi models
 * 2. When override is 'auto' or absent, auto-detection based on model name kicks in
 * 3. The provider name is correctly used for override lookup
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { OpenAIProvider } from './OpenAIProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
describe('OpenAIProvider.getToolFormat() - override vs auto-detection (issue #1943)', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    settingsService = new SettingsService();
  });

  const createWiredProvider = (): OpenAIProvider => {
    const wired = new OpenAIProvider('test-key');
    wired.setRuntimeSettingsService(settingsService);
    return wired;
  };

  it('returns "openai" override for a kimi model when provider toolFormat is set to "openai"', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'openai');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('openai');
  });

  it('auto-detects "kimi" format when provider toolFormat is "auto"', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'auto');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('auto-detects "kimi" format when no toolFormat override is set', () => {
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('auto-detects "mistral" format for mistral model when no override is set', () => {
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('mistral-large-latest');

    expect(provider.getToolFormat()).toBe('mistral');
  });

  it('returns explicit "kimi" override even for a standard openai model', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'kimi');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('gpt-4o');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('returns "openai" by default for standard models', () => {
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('gpt-4o');

    expect(provider.getToolFormat()).toBe('openai');
  });

  it('returns "qwen" for GLM models by auto-detection', () => {
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('openai:hf:zai-org/GLM-4.6');

    expect(provider.getToolFormat()).toBe('qwen');
  });

  it('returns "openai" for GLM models when override is set to "openai"', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'openai');
    const provider = createWiredProvider();
    vi.spyOn(provider, 'getModel').mockReturnValue('openai:hf:zai-org/GLM-4.6');

    expect(provider.getToolFormat()).toBe('openai');
  });
});
