/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import {
  loadExtensionByName,
  loadExtensionConfig,
} from '../../config/extension.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const debugLogger = DebugLogger.getLogger('llxprt:extensions:utils');

interface ExtensionConfig {
  name: string;
  version: string;
  settings?: unknown;
}

/**
 * Loads an extension and its config by name.
 * Logs error and returns nulls if extension not found or config invalid.
 *
 * @param name - Extension name to load
 * @returns Object with extension and extensionConfig, or nulls if not found
 */
export async function getExtensionAndConfig(name: string): Promise<{
  extension: GeminiCLIExtension | null;
  extensionConfig: ExtensionConfig | null;
}> {
  const extension = loadExtensionByName(name, process.cwd());

  if (extension == null) {
    debugLogger.error(`Extension "${name}" not found.`);
    return { extension: null, extensionConfig: null };
  }

  let extensionConfig: ExtensionConfig | null;
  try {
    extensionConfig = await loadExtensionConfig({
      extensionDir: extension.path,
      workspaceDir: process.cwd(),
    });
  } catch (error) {
    debugLogger.error(
      `Could not load configuration for extension "${name}".`,
      error,
    );
    return { extension: null, extensionConfig: null };
  }

  if (extensionConfig == null) {
    debugLogger.error(`Could not load configuration for extension "${name}".`);
    return { extension: null, extensionConfig: null };
  }

  return { extension, extensionConfig };
}
