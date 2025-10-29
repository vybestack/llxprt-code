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
const BUILTIN_ALIAS_DIR = path.join(__dirname, 'aliases');

export type ProviderAliasSource = 'user' | 'builtin';

export interface ProviderAliasConfig {
  name?: string;
  baseProvider: string;
  baseUrl?: string;
  defaultModel?: string;
  description?: string;
  providerConfig?: Record<string, unknown>;
  apiKeyEnv?: string;
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
