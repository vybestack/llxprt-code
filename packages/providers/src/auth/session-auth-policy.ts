/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionAuthPolicy } from './types.js';

export function createSessionAuthPolicyReader(
  settings: SettingsService,
): () => SessionAuthPolicy {
  return () => ({
    profileName: settings.getCurrentProfileName(),
    baseUrl:
      typeof settings.get('base-url') === 'string'
        ? String(settings.get('base-url'))
        : undefined,
    bucketPrompt: settings.get('auth-bucket-prompt'),
    bucketDelay: settings.get('auth-bucket-delay'),
    interactiveTimeoutMs: settings.get('auth.interactiveTimeoutMs'),
    noBrowser: settings.get('auth.noBrowser') === true,
    authOnly: settings.get('authOnly') === true,
  });
}
