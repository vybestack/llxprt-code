/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ContentGenerator,
  ContentGeneratorConfig,
} from '@llxprt/core';

/**
 * Creates a ContentGenerator using the active provider if available
 * @param config The content generator configuration
 * @param defaultGenerator Function to create the default Gemini generator
 * @returns A ContentGenerator instance
 */
export async function createProviderContentGenerator(
  config: ContentGeneratorConfig,
  defaultGenerator: () => Promise<ContentGenerator>,
): Promise<ContentGenerator> {
  // Provider support is now handled in the core package
  // This function is kept for backward compatibility
  return defaultGenerator();
}
