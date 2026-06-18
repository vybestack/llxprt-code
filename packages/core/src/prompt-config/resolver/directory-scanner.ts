/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { AvailableFile } from '../prompt-resolver.js';
import { fileExists, isDirectory, readDirectory } from './fs-adapter.js';

type FileType = 'core' | 'env' | 'tool';
type FileSource = 'model' | 'provider' | 'base';
type ScanFilter = 'core' | 'env' | 'tool' | 'all';

/** Add .md files from a directory to the available files list. */
function addMarkdownFiles(
  dirPath: string,
  type: FileType,
  source: FileSource,
  pathPrefix: string,
  availableFiles: AvailableFile[],
): void {
  const files = readDirectory(dirPath);
  for (const file of files) {
    if (file.endsWith('.md')) {
      availableFiles.push({
        path: `${pathPrefix}/${file}`,
        type,
        source,
      });
    }
  }
}

/** Check if a type matches the scan filter. */
function typeMatches(filter: ScanFilter, type: FileType): boolean {
  return filter === 'all' || filter === type;
}

/** Scan the base directory for core, env, and tool files. */
export function scanBaseDirectory(
  baseDir: string,
  fileType: ScanFilter,
  availableFiles: AvailableFile[],
): void {
  if (typeMatches(fileType, 'core')) {
    const corePath = path.join(baseDir, 'core.md');
    if (fileExists(corePath)) {
      availableFiles.push({ path: 'core.md', type: 'core', source: 'base' });
    }
  }

  if (typeMatches(fileType, 'env')) {
    scanSubDirectory(baseDir, 'env', 'env', availableFiles);
  }

  if (typeMatches(fileType, 'tool')) {
    scanSubDirectory(baseDir, 'tools', 'tool', availableFiles);
  }
}

/** Scan a named subdirectory for .md files. */
function scanSubDirectory(
  baseDir: string,
  subDir: string,
  type: FileType,
  availableFiles: AvailableFile[],
): void {
  const dirPath = path.join(baseDir, subDir);
  if (!isDirectory(dirPath)) {
    return;
  }
  addMarkdownFiles(dirPath, type, 'base', subDir, availableFiles);
}

/** Scan provider override directories. */
export function scanProviderOverrides(
  baseDir: string,
  fileType: ScanFilter,
  availableFiles: AvailableFile[],
): void {
  const providersDir = path.join(baseDir, 'providers');
  if (!isDirectory(providersDir)) {
    return;
  }
  const providers = readDirectory(providersDir);
  for (const provider of providers) {
    const providerPath = path.join(providersDir, provider);
    if (isDirectory(providerPath)) {
      scanProviderDirectory(providerPath, provider, fileType, availableFiles);
    }
  }
}

/** Scan a single provider directory for overrides. */
export function scanProviderDirectory(
  providerPath: string,
  provider: string,
  fileType: ScanFilter,
  availableFiles: AvailableFile[],
): void {
  const basePath = `providers/${provider}`;

  if (typeMatches(fileType, 'core')) {
    const corePath = path.join(providerPath, 'core.md');
    if (fileExists(corePath)) {
      availableFiles.push({
        path: `${basePath}/core.md`,
        type: 'core',
        source: 'provider',
      });
    }
  }

  if (typeMatches(fileType, 'env')) {
    const envDir = path.join(providerPath, 'env');
    if (isDirectory(envDir)) {
      addMarkdownFiles(
        envDir,
        'env',
        'provider',
        `${basePath}/env`,
        availableFiles,
      );
    }
  }

  if (typeMatches(fileType, 'tool')) {
    const toolsDir = path.join(providerPath, 'tools');
    if (isDirectory(toolsDir)) {
      addMarkdownFiles(
        toolsDir,
        'tool',
        'provider',
        `${basePath}/tools`,
        availableFiles,
      );
    }
  }

  // Check for models directory
  const modelsDir = path.join(providerPath, 'models');
  if (isDirectory(modelsDir)) {
    const models = readDirectory(modelsDir);
    for (const model of models) {
      const modelPath = path.join(modelsDir, model);
      if (isDirectory(modelPath)) {
        scanModelDirectory(
          modelPath,
          provider,
          model,
          fileType,
          availableFiles,
        );
      }
    }
  }
}

/** Scan a model-specific directory for overrides. */
export function scanModelDirectory(
  modelPath: string,
  provider: string,
  model: string,
  fileType: ScanFilter,
  availableFiles: AvailableFile[],
): void {
  const basePath = `providers/${provider}/models/${model}`;

  if (typeMatches(fileType, 'core')) {
    const corePath = path.join(modelPath, 'core.md');
    if (fileExists(corePath)) {
      availableFiles.push({
        path: `${basePath}/core.md`,
        type: 'core',
        source: 'model',
      });
    }
  }

  if (typeMatches(fileType, 'env')) {
    const envDir = path.join(modelPath, 'env');
    if (isDirectory(envDir)) {
      addMarkdownFiles(
        envDir,
        'env',
        'model',
        `${basePath}/env`,
        availableFiles,
      );
    }
  }

  if (typeMatches(fileType, 'tool')) {
    const toolsDir = path.join(modelPath, 'tools');
    if (isDirectory(toolsDir)) {
      addMarkdownFiles(
        toolsDir,
        'tool',
        'model',
        `${basePath}/tools`,
        availableFiles,
      );
    }
  }
}
