/**
 * @issue #2182 - Mixed-provider load balancer profiles (e.g. opusfirst,
 * gptfirst) fail with 400 "text: Extra inputs are not permitted" and
 * "streamIdleTimeoutMs: Extra inputs are not permitted".
 *
 * Root cause: unrecognized ephemeral setting keys default to the modelParams
 * bucket (API pass-through). Two specific gaps caused both reported errors:
 *
 *  1. `streamIdleTimeoutMs` (camelCase, written from settings.json) is never
 *     aliased to its canonical `stream-idle-timeout-ms`, so it has no spec and
 *     leaks into modelParams, then into every provider's request body.
 *  2. The nested object form `text: { verbosity: "medium" }` is not flattened
 *     into the registered flat key `text.verbosity`, so the whole `text`
 *     object leaks into modelParams as an unknown key.
 *
 * These tests pin the robust behavior: the registry resolves the camelCase
 * alias and flattens any nested object whose key is a known registry prefix,
 * so neither value ever reaches the API request body (modelParams).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAlias,
  getSettingSpec,
  separateSettings,
} from '../settings/settingsRegistry.js';

describe('issue #2182: streamIdleTimeoutMs camelCase alias', () => {
  it('resolves streamIdleTimeoutMs to the canonical stream-idle-timeout-ms', () => {
    expect(resolveAlias('streamIdleTimeoutMs')).toBe('stream-idle-timeout-ms');
  });

  it('finds the cli-behavior spec for streamIdleTimeoutMs via the alias', () => {
    const spec = getSettingSpec('streamIdleTimeoutMs');
    expect(spec?.key).toBe('stream-idle-timeout-ms');
    expect(spec?.category).toBe('cli-behavior');
  });

  it('does not leak streamIdleTimeoutMs into modelParams for anthropic', () => {
    const result = separateSettings(
      { streamIdleTimeoutMs: 60_000 },
      'anthropic',
    );
    expect(result.modelParams['streamIdleTimeoutMs']).toBeUndefined();
    expect(result.modelParams['stream_idle_timeout_ms']).toBeUndefined();
    expect(result.modelParams['stream-idle-timeout-ms']).toBeUndefined();
  });

  it('classifies streamIdleTimeoutMs into cliSettings for every provider', () => {
    for (const provider of ['anthropic', 'codex', 'openai', 'gemini']) {
      const result = separateSettings(
        { streamIdleTimeoutMs: 60_000 },
        provider,
      );
      expect(result.cliSettings['stream-idle-timeout-ms']).toBe(60_000);
      expect(Object.keys(result.modelParams)).not.toContain(
        'streamIdleTimeoutMs',
      );
    }
  });

  it('treats the canonical hyphenated key identically', () => {
    const canonical = separateSettings(
      { 'stream-idle-timeout-ms': 60_000 },
      'anthropic',
    );
    const camel = separateSettings(
      { streamIdleTimeoutMs: 60_000 },
      'anthropic',
    );
    expect(camel.cliSettings['stream-idle-timeout-ms']).toBe(
      canonical.cliSettings['stream-idle-timeout-ms'],
    );
  });
});

describe('issue #2182: nested object flattening for registry prefixes', () => {
  it('flattens nested text object into text.verbosity (model-behavior)', () => {
    const result = separateSettings(
      { text: { verbosity: 'medium' } },
      'anthropic',
    );
    expect(result.modelBehavior['text.verbosity']).toBe('medium');
  });

  it('does not leak a nested text object into modelParams', () => {
    const result = separateSettings(
      { text: { verbosity: 'medium' } },
      'anthropic',
    );
    expect(result.modelParams['text']).toBeUndefined();
    expect(result.modelParams['text.verbosity']).toBeUndefined();
  });

  it('does not leak a nested text object for the openai provider either', () => {
    const result = separateSettings(
      { text: { verbosity: 'medium' } },
      'openai-responses',
    );
    expect(result.modelParams['text']).toBeUndefined();
    expect(result.modelBehavior['text.verbosity']).toBe('medium');
  });

  it('flattens nested compression object into registered dotted keys', () => {
    const result = separateSettings(
      { compression: { strategy: 'middle-out', profile: 'default' } },
      'anthropic',
    );
    expect(result.cliSettings['compression.strategy']).toBe('middle-out');
    expect(result.cliSettings['compression.profile']).toBe('default');
    expect(result.modelParams['compression']).toBeUndefined();
  });

  it('flattens deeply nested compression.density objects', () => {
    const result = separateSettings(
      {
        compression: {
          density: { optimizeThreshold: 0.5 },
          strategy: 'one-shot',
        },
      },
      'anthropic',
    );
    expect(result.cliSettings['compression.density.optimizeThreshold']).toBe(
      0.5,
    );
    expect(result.cliSettings['compression.strategy']).toBe('one-shot');
    expect(result.modelParams['compression']).toBeUndefined();
  });

  it('keeps explicit flat keys winning over nested object extraction', () => {
    const result = separateSettings(
      {
        'text.verbosity': 'low',
        text: { verbosity: 'high' },
      },
      'anthropic',
    );
    expect(result.modelBehavior['text.verbosity']).toBe('low');
  });

  it('lets provider overrides win over base-level flat keys (cross-source precedence)', () => {
    // Base exposes a flat key; the provider-specific override arrives as a
    // nested container of the same prefix. The override must win.
    const result = separateSettings(
      {
        'text.verbosity': 'low',
        openai: { text: { verbosity: 'high' } },
      },
      'openai',
    );
    expect(result.modelBehavior['text.verbosity']).toBe('high');
  });

  it('preserves an explicit top-level reasoning object alongside its flattened keys', () => {
    const result = separateSettings(
      { reasoning: { enabled: true, effort: 'high' } },
      'anthropic',
    );
    expect(result.modelBehavior['reasoning.enabled']).toBe(true);
    expect(result.modelBehavior['reasoning.effort']).toBe('high');
  });

  it('does not flatten arbitrary unknown object model-params', () => {
    const result = separateSettings(
      { response_format: { type: 'json_object' } },
      'openai',
    );
    expect(result.modelParams['response_format']).toStrictEqual({
      type: 'json_object',
    });
  });
});
