/**
 * @issue #1943 - OpenAI providers ignore explicit toolFormat override for kimi model names
 *
 * Behavioral tests for resolveToolFormat() and getToolFormatOverride() confirming
 * that explicit provider-level toolFormat overrides take precedence over model-name
 * auto-detection.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveToolFormat,
  getToolFormatOverride,
  VALID_TOOL_FORMATS,
  type ToolFormatSettings,
} from './toolFormatDetection.js';
import { detectToolFormat } from './toolFormatDetection.js';

function createMockSettings(
  providerSettings: Record<string, Record<string, unknown>> = {},
): ToolFormatSettings {
  return {
    getProviderSettings: (providerName: string) =>
      providerSettings[providerName],
  };
}

describe('resolveToolFormat (issue #1943)', () => {
  it('uses explicit "openai" override instead of auto-detecting "kimi" for kimi model names', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openai' },
    });
    const format = resolveToolFormat('moonshot-v1-kimi-k2', 'openai', settings);
    expect(format).toBe('openai');
  });

  it('uses explicit "openai" override instead of auto-detecting "mistral" for mistral model names', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openai' },
    });
    const format = resolveToolFormat(
      'mistral-large-latest',
      'openai',
      settings,
    );
    expect(format).toBe('openai');
  });

  it('uses explicit "openai" override instead of auto-detecting "qwen" for GLM models', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openai' },
    });
    const format = resolveToolFormat('glm-4', 'openai', settings);
    expect(format).toBe('openai');
  });

  it('auto-detects "kimi" when override is "auto"', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'auto' },
    });
    const format = resolveToolFormat('moonshot-v1-kimi-k2', 'openai', settings);
    expect(format).toBe('kimi');
  });

  it('auto-detects "openai" when no override is set', () => {
    const settings = createMockSettings({});
    const format = resolveToolFormat('gpt-4o', 'openai', settings);
    expect(format).toBe('openai');
  });

  it('auto-detects "kimi" when no override is set for kimi model', () => {
    const settings = createMockSettings({});
    const format = resolveToolFormat('kimi-k2', 'openai', settings);
    expect(format).toBe('kimi');
  });

  it('uses explicit "kimi" override even for a standard model that would auto-detect as "openai"', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'kimi' },
    });
    const format = resolveToolFormat('gpt-4o', 'openai', settings);
    expect(format).toBe('kimi');
  });

  it('isolates overrides per provider - openai override does not affect kimi provider lookup', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openai' },
      // kimi provider has no override
    });
    // Even though openai has override=kimi, looking up 'kimi' provider finds nothing
    const format = resolveToolFormat('moonshot-v1-kimi-k2', 'kimi', settings);
    expect(format).toBe('kimi'); // auto-detected since kimi provider has no override
  });

  it('falls back to detectToolFormat when settings returns undefined for provider', () => {
    const settings: ToolFormatSettings = {
      getProviderSettings: () => undefined,
    };
    const format = resolveToolFormat(
      'mistral-small-latest',
      'openai',
      settings,
    );
    expect(format).toBe('mistral');
  });

  it('ignores non-string toolFormat values in provider settings', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 42 }, // invalid: not a string
    });
    const format = resolveToolFormat('kimi-k2', 'openai', settings);
    expect(format).toBe('kimi'); // falls back to auto-detect
  });

  it('ignores invalid toolFormat string and falls back to auto-detect', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'invalid-format' },
    });
    const format = resolveToolFormat('kimi-k2', 'openai', settings);
    expect(format).toBe('kimi'); // ignored, auto-detected
  });

  it('ignores misspelled toolFormat and falls back to auto-detect', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openaai' }, // typo
    });
    const format = resolveToolFormat('gpt-4o', 'openai', settings);
    expect(format).toBe('openai'); // ignored, auto-detected
  });

  it('logs warning when invalid toolFormat override is ignored', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'bogus' },
    });
    const mockLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      enabled: true,
    };
    resolveToolFormat(
      'gpt-4o',
      'openai',
      settings,
      mockLogger as unknown as import('../../debug/index.js').DebugLogger,
    );
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('ignores undefined toolFormat in provider settings', () => {
    const settings = createMockSettings({
      openai: { toolFormat: undefined },
    });
    const format = resolveToolFormat('kimi-k2', 'openai', settings);
    expect(format).toBe('kimi');
  });
});

describe('getToolFormatOverride (issue #1943)', () => {
  it('returns the explicit override value when set', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openai' },
    });
    expect(getToolFormatOverride('openai', settings)).toBe('openai');
  });

  it('returns "auto" when override is set to auto', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'auto' },
    });
    expect(getToolFormatOverride('openai', settings)).toBe('auto');
  });

  it('returns undefined when no override is set', () => {
    const settings = createMockSettings({});
    expect(getToolFormatOverride('openai', settings)).toBeUndefined();
  });

  it('returns undefined when provider settings are undefined', () => {
    const settings: ToolFormatSettings = {
      getProviderSettings: () => undefined,
    };
    expect(getToolFormatOverride('openai', settings)).toBeUndefined();
  });

  it('returns undefined for non-string toolFormat values', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 42 },
    });
    expect(getToolFormatOverride('openai', settings)).toBeUndefined();
  });

  it('returns undefined for invalid toolFormat string not in VALID_TOOL_FORMATS', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'invalid-format' },
    });
    expect(getToolFormatOverride('openai', settings)).toBeUndefined();
  });

  it('returns undefined for misspelled toolFormat string', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openaai' },
    });
    expect(getToolFormatOverride('openai', settings)).toBeUndefined();
  });

  it('logs warning when invalid toolFormat override is provided', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'bogus' },
    });
    const mockLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      enabled: true,
    };
    getToolFormatOverride(
      'openai',
      settings,
      mockLogger as unknown as import('../../debug/index.js').DebugLogger,
    );
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('does not log warning for valid toolFormat strings', () => {
    const settings = createMockSettings({
      openai: { toolFormat: 'openai' },
    });
    const mockLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      enabled: true,
    };
    getToolFormatOverride(
      'openai',
      settings,
      mockLogger as unknown as import('../../debug/index.js').DebugLogger,
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe('detectToolFormat (existing auto-detection, unchanged)', () => {
  it('detects kimi format for Kimi K2 models', () => {
    expect(detectToolFormat('kimi-k2')).toBe('kimi');
    expect(detectToolFormat('moonshot-v1-kimi-k2')).toBe('kimi');
  });

  it('defaults to openai format for standard models', () => {
    expect(detectToolFormat('gpt-4o')).toBe('openai');
  });

  it('defaults to openai format for unknown models', () => {
    expect(detectToolFormat('some-custom-model')).toBe('openai');
  });
});

describe('VALID_TOOL_FORMATS', () => {
  it('contains all known ToolFormat literals plus auto', () => {
    const expectedFormats = [
      'openai',
      'anthropic',
      'deepseek',
      'qwen',
      'kimi',
      'mistral',
      'hermes',
      'xml',
      'llama',
      'gemma',
      'auto',
    ];
    for (const fmt of expectedFormats) {
      expect(VALID_TOOL_FORMATS.has(fmt)).toBe(true);
    }
    expect(VALID_TOOL_FORMATS.size).toBe(expectedFormats.length);
  });
});
