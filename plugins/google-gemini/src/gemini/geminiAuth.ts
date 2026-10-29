/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type GeminiAuthMode = 'gemini-api-key' | 'vertex-ai' | 'none';

export interface VertexAIAuthConfig {
  project?: string;
  location?: string;
}

export function getNonEmptySetting(
  settings: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = settings?.[key];
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

export function getVertexAIAuthConfig(
  settings: Readonly<Record<string, unknown>>,
): VertexAIAuthConfig {
  return {
    project: getNonEmptySetting(settings, 'GOOGLE_CLOUD_PROJECT'),
    location: getNonEmptySetting(settings, 'GOOGLE_CLOUD_LOCATION'),
  };
}

export function hasVertexAICredentials(
  settings: Readonly<Record<string, unknown>>,
): boolean {
  if (
    settings['GOOGLE_GENAI_USE_VERTEXAI'] === false ||
    settings['GOOGLE_GENAI_USE_VERTEXAI'] === 'false'
  )
    return false;
  const vertex = getVertexAIAuthConfig(settings);
  return Boolean(
    (vertex.project && vertex.location) ||
      getNonEmptySetting(settings, 'GOOGLE_APPLICATION_CREDENTIALS'),
  );
}
