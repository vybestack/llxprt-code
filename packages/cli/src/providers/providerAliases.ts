/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy CLI boundary retained while larger decomposition continues. */

import * as fs from 'fs';
import * as path from 'path';
import stripJsonComments from 'strip-json-comments';
import { Storage, debugLogger } from '@vybestack/llxprt-code-core';
import { fileURLToPath } from 'url';

const SUPPORTED_EXTENSIONS = new Set(['.config', '.json']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Handle different directory structures between development and bundle environments
// In development: packages/cli/src/providers/aliases/
// In bundle: bundle/providers/aliases/
const BUNDLE_ALIAS_DIR = path.join(__dirname, 'providers', 'aliases');
const DEV_ALIAS_DIR = path.join(__dirname, 'aliases');

// Prefer the bundle layout if it actually exists, otherwise fall back to dev layout.
const BUILTIN_ALIAS_DIR = fs.existsSync(BUNDLE_ALIAS_DIR)
  ? BUNDLE_ALIAS_DIR
  : DEV_ALIAS_DIR;

export type ProviderAliasSource = 'user' | 'builtin';

export interface StaticModelEntry {
  id: string;
  name: string;
}

export interface ModelDefaultRule {
  pattern: string;
  ephemeralSettings: Record<string, unknown>;
}

export interface ProviderAliasConfig {
  name?: string;
  baseProvider: string;
  /** Base URL for the provider API (consistent with profile ephemeral settings) */
  'base-url'?: string;
  /** Overrides base-url when running in a container sandbox (Docker/Podman) */
  'sandbox-base-url'?: string;
  /** When false, bypasses API key validation for providers that don't need auth */
  'requires-auth'?: boolean;
  defaultModel?: string;
  ephemeralSettings?: Record<string, unknown>;
  description?: string;
  providerConfig?: Record<string, unknown>;
  apiKeyEnv?: string;
  /** Provider ID from models.dev for filtering in ModelsDialog */
  modelsDevProviderId?: string | null;
  /**
   * Static list of models to return from getModels() instead of fetching from API.
   * Use this for providers that don't have a /models endpoint or when you want
   * to restrict the available models to a specific set.
   */
  staticModels?: StaticModelEntry[];
  /**
   * Per-model ephemeral setting overrides. Rules are matched against the model
   * name using RegExp.test() and applied in order — later rules override earlier
   * ones for the same key. Invalid patterns are stripped at parse time.
   */
  modelDefaults?: ModelDefaultRule[];
}

export interface ProviderAliasEntry {
  alias: string;
  config: ProviderAliasConfig;
  filePath: string;
  source: ProviderAliasSource;
}

export function getUserAliasDir(): string {
  return path.join(Storage.getGlobalLlxprtDir(), 'providers');
}

function getAliasDirectories(): Array<{
  path: string;
  source: ProviderAliasSource;
}> {
  const directories: Array<{ path: string; source: ProviderAliasSource }> = [];

  directories.push({ path: getUserAliasDir(), source: 'user' });

  if (fs.existsSync(BUILTIN_ALIAS_DIR)) {
    directories.push({ path: BUILTIN_ALIAS_DIR, source: 'builtin' });
  }

  return directories;
}

/** Validates a single modelDefaults entry; returns true when the entry is valid. */
function isValidModelDefaultRule(
  entry: unknown,
  filePath: string,
): entry is ModelDefaultRule {
  // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  if (
    entry === null ||
    entry === undefined ||
    typeof entry !== 'object' ||
    Array.isArray(entry)
  ) {
    debugLogger.warn(
      `[ProviderAliases] Skipping non-object modelDefaults entry in ${filePath}`,
    );
    return false;
  }

  const rule = entry as Record<string, unknown>;

  if (typeof rule.pattern !== 'string') {
    debugLogger.warn(
      `[ProviderAliases] Skipping modelDefaults entry with non-string pattern in ${filePath}`,
    );
    return false;
  }

  if (rule.pattern === '') {
    debugLogger.warn(
      `[ProviderAliases] Skipping modelDefaults entry with empty pattern in ${filePath}`,
    );
    return false;
  }

  if (
    rule.ephemeralSettings === null ||
    rule.ephemeralSettings === undefined ||
    typeof rule.ephemeralSettings !== 'object' ||
    Array.isArray(rule.ephemeralSettings)
  ) {
    debugLogger.warn(
      `[ProviderAliases] Skipping modelDefaults entry with invalid ephemeralSettings in ${filePath}`,
    );
    return false;
  }

  try {
    new RegExp(rule.pattern);
  } catch {
    debugLogger.warn(
      `[ProviderAliases] Skipping modelDefaults entry with invalid regex pattern "${rule.pattern}" in ${filePath}`,
    );
    return false;
  }

  return true;
}

/** Sanitizes the modelDefaults array on an alias config in place. */
function sanitizeModelDefaults(
  aliasConfig: ProviderAliasConfig,
  filePath: string,
): void {
  if (!('modelDefaults' in aliasConfig)) {
    return;
  }
  if (!Array.isArray(aliasConfig.modelDefaults)) {
    debugLogger.warn(
      `[ProviderAliases] Ignoring non-array modelDefaults in ${filePath}`,
    );
    aliasConfig.modelDefaults = undefined;
    return;
  }
  aliasConfig.modelDefaults = aliasConfig.modelDefaults.filter((entry) =>
    isValidModelDefaultRule(entry, filePath),
  );
}

/** Validates scalar-typed fields on an alias config in place. */
function sanitizeAliasConfigFields(
  aliasConfig: ProviderAliasConfig,
  filePath: string,
): void {
  if (
    Object.prototype.hasOwnProperty.call(aliasConfig, 'sandbox-base-url') &&
    typeof aliasConfig['sandbox-base-url'] !== 'string'
  ) {
    debugLogger.warn(
      `[ProviderAliases] Ignoring non-string sandbox-base-url in ${filePath}`,
    );
    aliasConfig['sandbox-base-url'] = undefined;
  }

  if (
    Object.prototype.hasOwnProperty.call(aliasConfig, 'requires-auth') &&
    typeof aliasConfig['requires-auth'] !== 'boolean'
  ) {
    debugLogger.warn(
      `[ProviderAliases] Ignoring non-boolean requires-auth in ${filePath}`,
    );
    aliasConfig['requires-auth'] = undefined;
  }
}

function readAliasFile(
  filePath: string,
  source: ProviderAliasSource,
): ProviderAliasEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      debugLogger.warn(
        `[ProviderAliases] Ignoring invalid alias file ${filePath}`,
      );
      return null;
    }

    const aliasConfig = parsed as ProviderAliasConfig;
    const alias =
      (aliasConfig.name && aliasConfig.name.trim().length > 0
        ? aliasConfig.name
        : path.basename(filePath, path.extname(filePath))) || '';

    if (!alias) {
      debugLogger.warn(
        `[ProviderAliases] Alias file ${filePath} does not specify a valid alias name`,
      );
      return null;
    }

    if (!aliasConfig.baseProvider) {
      debugLogger.warn(
        `[ProviderAliases] Alias '${alias}' is missing required baseProvider`,
      );
      return null;
    }

    sanitizeAliasConfigFields(aliasConfig, filePath);
    sanitizeModelDefaults(aliasConfig, filePath);

    return {
      alias,
      config: aliasConfig,
      filePath,
      source,
    };
  } catch (error) {
    debugLogger.warn(
      `[ProviderAliases] Failed to load alias from ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export function loadProviderAliasEntries(): ProviderAliasEntry[] {
  const aliases: ProviderAliasEntry[] = [];

  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (const directory of getAliasDirectories()) {
    if (!fs.existsSync(directory.path)) {
      continue;
    }

    let files: string[] = [];
    try {
      files = fs.readdirSync(directory.path);
    } catch (error) {
      debugLogger.warn(
        `[ProviderAliases] Failed to read directory ${directory.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    for (const file of files) {
      const extension = path.extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        continue;
      }

      const fullPath = path.join(directory.path, file);
      const entry = readAliasFile(fullPath, directory.source);
      if (entry) {
        aliases.push(entry);
      }
    }
  }

  return aliases;
}

export function getAliasFilePath(alias: string): string {
  return path.join(getUserAliasDir(), `${alias}.config`);
}

export function writeProviderAliasConfig(
  alias: string,
  config: ProviderAliasConfig,
): string {
  const aliasDir = getUserAliasDir();
  fs.mkdirSync(aliasDir, { recursive: true });
  const filePath = getAliasFilePath(alias);

  const sanitizedConfig: ProviderAliasConfig = Object.fromEntries(
    Object.entries(config).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  ) as ProviderAliasConfig;

  fs.writeFileSync(filePath, JSON.stringify(sanitizedConfig, null, 2));
  return filePath;
}
