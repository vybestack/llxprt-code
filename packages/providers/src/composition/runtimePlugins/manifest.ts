/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { ProviderAliasConfig } from '../providerAliases.js';
import type { ProviderAliasFactory, RuntimePluginManifest } from './types.js';

export const RUNTIME_PLUGIN_SUPPORTED_API_VERSION = 1;

/**
 * True when the value is a non-null, non-array object that can be indexed as a
 * string record. Used to validate untrusted plugin export shapes.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Alias configs are a plugin-declared subset of the loose file-based
 * {@link ProviderAliasConfig}. Only `baseProvider` is required; the remaining known
 * keys mirror the file path and unknown keys are carried through. The manifest and
 * contribution objects themselves are strict, but the alias config is deliberately open so
 * plugin authors can supply provider-specific keys the file path also accepts.
 */
function createAliasConfigSchema(): ReturnType<
  typeof z.custom<ProviderAliasConfig>
> {
  return z.custom<ProviderAliasConfig>(
    (value): value is ProviderAliasConfig =>
      isRecord(value) &&
      typeof value.baseProvider === 'string' &&
      value.baseProvider !== '',
  );
}

const RUNTIME_CONTRIBUTED_ALIAS_SCHEMA = z
  .object({
    alias: z.string().min(1),
    config: createAliasConfigSchema(),
  })
  .strict();

const RUNTIME_PROVIDER_CONTRIBUTION_SCHEMA = z
  .object({
    providerId: z.string().min(1),
    createProvider: z.custom<ProviderAliasFactory>(
      (value): value is ProviderAliasFactory => typeof value === 'function',
    ),
    builtinAliases: z.array(RUNTIME_CONTRIBUTED_ALIAS_SCHEMA).optional(),
  })
  .strict();

const RUNTIME_PLUGIN_MANIFEST_SCHEMA = z
  .object({
    apiVersion: z.literal(RUNTIME_PLUGIN_SUPPORTED_API_VERSION),
    id: z.string().min(1),
    providers: z.array(RUNTIME_PROVIDER_CONTRIBUTION_SCHEMA).min(1),
  })
  .strict();

/** A plugin exports a manifest with an apiVersion this CLI does not support. */
export class RuntimePluginIncompatibleError extends Error {
  readonly specifier: string;
  readonly observedVersion: number;
  readonly supportedVersion: number;

  constructor(
    specifier: string,
    observedVersion: number,
    supportedVersion: number,
  ) {
    super(
      `Runtime plugin '${specifier}' exports apiVersion ${observedVersion}, ` +
        `but only apiVersion ${supportedVersion} is supported.`,
    );
    this.name = 'RuntimePluginIncompatibleError';
    this.specifier = specifier;
    this.observedVersion = observedVersion;
    this.supportedVersion = supportedVersion;
  }
}

/** A plugin exports a manifest that fails Zod validation. */
export class RuntimePluginMalformedError extends Error {
  readonly specifier: string;
  readonly issues: string;

  constructor(
    specifier: string,
    issues: Array<{ path: PropertyKey[]; message: string }>,
  ) {
    const detail = issues
      .map((issue) => {
        const joined = issue.path.join('.');
        return joined === '' ? issue.message : `${joined}: ${issue.message}`;
      })
      .join('; ');
    super(`Runtime plugin '${specifier}' has a malformed manifest: ${detail}.`);
    this.name = 'RuntimePluginMalformedError';
    this.specifier = specifier;
    this.issues = detail;
  }
}

/**
 * Validates a raw plugin export as a manifest v1 and returns a deep-frozen
 * manifest. A present apiVersion other than 1 produces an incompatible-plugin error;
 * any other violation produces a malformed-manifest error naming the specifier and the
 * Zod issue paths.
 */
export function parseRuntimePluginManifest(
  specifier: string,
  value: unknown,
): RuntimePluginManifest {
  if (!isRecord(value)) {
    throw new RuntimePluginMalformedError(specifier, [
      { path: [], message: 'manifest is not an object' },
    ]);
  }

  const apiVersion = value.apiVersion;
  if (
    typeof apiVersion === 'number' &&
    apiVersion !== RUNTIME_PLUGIN_SUPPORTED_API_VERSION
  ) {
    throw new RuntimePluginIncompatibleError(
      specifier,
      apiVersion,
      RUNTIME_PLUGIN_SUPPORTED_API_VERSION,
    );
  }

  const parsed = RUNTIME_PLUGIN_MANIFEST_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new RuntimePluginMalformedError(specifier, parsed.error.issues);
  }

  deepFreezeManifest(parsed.data);
  return parsed.data;
}

/**
 * Recursively freezes plain objects and arrays reachable from a validated
 * manifest. Alias configs carry nested structures (staticModels,
 * providerConfig, ephemeralSettings, modelDefaults, mediaSupport); freezing only
 * the top level would leave a plugin able to mutate its own manifest after
 * validation, including between alias refreshes. Functions are left alone: the
 * contributed factories must stay callable.
 */
function deepFreezeValue(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreezeValue(nested, seen);
  }
  Object.freeze(value);
}

function deepFreezeManifest(manifest: RuntimePluginManifest): void {
  const seen = new WeakSet<object>();
  for (const contribution of manifest.providers) {
    for (const alias of contribution.builtinAliases ?? []) {
      deepFreezeValue(alias, seen);
    }
    if (contribution.builtinAliases) {
      Object.freeze(contribution.builtinAliases);
    }
    Object.freeze(contribution);
  }
  Object.freeze(manifest.providers);
  Object.freeze(manifest);
}
