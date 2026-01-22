/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import stripJsonComments from 'strip-json-comments';
import { Storage } from '@vybestack/llxprt-code-core';
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

export interface ProviderAliasConfig {
  name?: string;
  baseProvider: string;
  /** @deprecated Use 'base-url' for consistency with profiles */
  baseUrl?: string;
  /** Base URL for the provider API (consistent with profile ephemeral settings) */
  'base-url'?: string;
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

function readAliasFile(
  filePath: string,
  source: ProviderAliasSource,
): ProviderAliasEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(stripJsonComments(raw)) as ProviderAliasConfig;
    if (!parsed || typeof parsed !== 'object') {
      console.warn(`[ProviderAliases] Ignoring invalid alias file ${filePath}`);
      return null;
    }

    const alias =
      (parsed.name && parsed.name.trim().length > 0
        ? parsed.name
        : path.basename(filePath, path.extname(filePath))) || '';

    if (!alias) {
      console.warn(
        `[ProviderAliases] Alias file ${filePath} does not specify a valid alias name`,
      );
      return null;
    }

    if (!parsed.baseProvider) {
      console.warn(
        `[ProviderAliases] Alias '${alias}' is missing required baseProvider`,
      );
      return null;
    }

    return {
      alias,
      config: parsed,
      filePath,
      source,
    };
  } catch (error) {
    console.warn(
      `[ProviderAliases] Failed to load alias from ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export function loadProviderAliasEntries(): ProviderAliasEntry[] {
  const aliases: ProviderAliasEntry[] = [];

  for (const directory of getAliasDirectories()) {
    if (!fs.existsSync(directory.path)) {
      continue;
    }

    let files: string[] = [];
    try {
      files = fs.readdirSync(directory.path);
    } catch (error) {
      console.warn(
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
