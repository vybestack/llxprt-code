/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadEnvironment, loadSettings } from './settings.js';

export function validateAuthMethod(authMethod: string): string | null {
  loadEnvironment(loadSettings().merged);

  if (
    authMethod === 'oauth_gemini' ||
    authMethod === 'oauth-gemini' ||
    authMethod === 'oauth_qwen' ||
    authMethod === 'oauth_anthropic'
  ) {
    return null;
  }

  if (authMethod === 'provider') {
    return null;
  }

  if (authMethod === 'oauth-personal' || authMethod === 'cloud-shell') {
    return null;
  }

  if (authMethod === 'gemini-api-key') {
    if (!process.env.GEMINI_API_KEY) {
      return 'GEMINI_API_KEY environment variable not found. Add that to your environment and try again (no reload needed if using .env)!';
    }
    return null;
  }

  if (authMethod === 'vertex-ai') {
    const hasVertexProjectLocationConfig =
      !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
    const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
    if (!hasVertexProjectLocationConfig && !hasGoogleApiKey) {
      return (
        'When using Vertex AI, you must specify either:\n' +
        '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
        '• GOOGLE_API_KEY environment variable (if using express mode).\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  if (authMethod === 'none') {
    // "None" is always valid - allows using environment variables or keyfiles
    return null;
  }

  return 'Invalid auth method selected.';
}
