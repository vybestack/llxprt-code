/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: maps the settings of a frozen Anthropic case (the
 * ephemerals and provider settings the real send read) to the settings the
 * length model takes. The routes in the corpus use the native endpoint, no
 * OAuth, and URL images are supported.
 */

import type { FrozenSettings } from '../../../../../__tests__/support/frozenWire/frozenCases.js';
import type { StripPolicy, WireSettings } from '../wireBuilderHarness.js';
import type { CacheOpts } from './referenceFinish.js';

export const NATIVE_BASE_URL = 'https://api.anthropic.com';

function stripOf(value: unknown): StripPolicy | undefined {
  if (value === undefined) return undefined;
  if (value === 'none' || value === 'all' || value === 'allButLast') {
    return value;
  }
  throw new Error(`unknown reasoning.stripFromContext ${String(value)}`);
}

function booleanOf(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new Error(`expected a boolean setting, saw ${String(value)}`);
}

export function wireSettingsOf(
  model: string,
  ephemerals: Readonly<Record<string, unknown>>,
): WireSettings {
  const dimension = ephemerals['max-image-dimension'];
  return {
    reasoningEnabled: ephemerals['reasoning.enabled'] === true,
    strip: stripOf(ephemerals['reasoning.stripFromContext']),
    includeInContext: booleanOf(ephemerals['reasoning.includeInContext']),
    currentModel: model,
    currentBaseURL: NATIVE_BASE_URL,
    supportsUrlImages: true,
    isOAuth: false,
    imageBudget:
      typeof dimension === 'number' ? { maxDimension: dimension } : undefined,
  };
}

export function cacheOf(
  providerSettings: Readonly<Record<string, unknown>>,
  ephemerals: Readonly<Record<string, unknown>>,
): CacheOpts {
  const ttl = providerSettings['prompt-caching'];
  const purge = ephemerals['media.semantic-purge'];
  return {
    ...(ttl === '5m' || ttl === '1h' ? { ttl } : {}),
    mediaPurge: purge === 'remove' || purge === 'summary',
  };
}

export function frozenSettingsInputs(settings: FrozenSettings): {
  wire: WireSettings;
  cache: CacheOpts;
} {
  return {
    wire: wireSettingsOf(settings.model, settings.ephemerals),
    cache: cacheOf(settings.providerSettings, settings.ephemerals),
  };
}
