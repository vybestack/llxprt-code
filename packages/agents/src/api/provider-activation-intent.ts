/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderActivationIntent } from './config-types.js';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function canonicalProviderActivationIntent(
  intent: ProviderActivationIntent,
): string {
  const overrides = intent.cliOverrides;
  return JSON.stringify(
    normalize({
      ...intent,
      provider: intent.provider ?? '',
      defaultProvider: intent.defaultProvider ?? '',
      model: intent.model ?? '',
      authMode: intent.authMode ?? 'auto',
      authMethod: intent.authMethod ?? '',
      providerSwitchPolicy: intent.providerSwitchPolicy ?? 'strict',
      cliOverrides:
        overrides === undefined
          ? undefined
          : {
              ...overrides,
              set:
                overrides.set === undefined
                  ? undefined
                  : [...overrides.set].sort(),
            },
    }),
  );
}
