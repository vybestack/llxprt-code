/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type GeminiAuthMode = 'gemini-api-key' | 'vertex-ai' | 'none';

/**
 * Checks if Vertex AI credentials are available via environment variables.
 *
 * The `no-restricted-syntax` rule is intentionally not suppressed here:
 * environment-variable existence checks are the intended pattern at this
 * auth boundary. Callers must keep the eslint config allowing these reads
 * (see eslint.config.js completedDirectiveCleanupScopes / legacy overrides).
 */
export function hasVertexAICredentials(): boolean {
  const hasProjectAndLocation =
    !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
  const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
  const hasApplicationCredentials =
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return hasProjectAndLocation || hasGoogleApiKey || hasApplicationCredentials;
}

/** Set up the environment variable for Vertex AI authentication. */
export function setupVertexAIAuth(): void {
  process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
}
