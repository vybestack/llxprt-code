/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  discoverBrowserProfiles,
  validateProfileDirectory,
} from '@vybestack/llxprt-code-core';
import type { MessageActionReturn } from './types.js';

const BROWSER_PROFILE_ASSOCIATION_BROWSER = 'chrome' as const;

interface ResolvedProfileSelector {
  readonly profileDirectory: string;
  readonly displayName?: string;
}

function resolveProfileSelector(
  selector: string,
): ResolvedProfileSelector | undefined {
  const trimmed = selector.trim();
  const numericMatch = trimmed.match(/^(\d+)$/);
  if (numericMatch !== null) {
    const index = parseInt(numericMatch[1], 10) - 1;
    const profiles = discoverBrowserProfiles(
      BROWSER_PROFILE_ASSOCIATION_BROWSER,
    );
    if (index < 0 || index >= profiles.length) {
      return undefined;
    }
    const profile = profiles[index];
    return {
      profileDirectory: profile.directoryName,
      displayName: profile.displayName,
    };
  }
  try {
    validateProfileDirectory(trimmed);
  } catch {
    return undefined;
  }
  return { profileDirectory: trimmed };
}

export function handleDiscoverBrowserProfiles(
  provider: string,
  bucket: string,
): MessageActionReturn {
  try {
    const profiles = discoverBrowserProfiles(
      BROWSER_PROFILE_ASSOCIATION_BROWSER,
    );

    if (profiles.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content:
          `No Chrome profiles were detected for ${provider} bucket "${bucket}".\n` +
          `You can associate a profile manually with:\n` +
          `  /auth ${provider} profile ${bucket} <profile-directory>`,
      };
    }

    const lines: string[] = [
      `Discovered Chrome profiles for ${provider} bucket "${bucket}":`,
      '',
      ...profiles.map(
        (profile, index) =>
          `  ${index + 1}: ${profile.displayName} ` +
          `(profile: ${profile.directoryName})`,
      ),
      '',
      `To associate a profile, run:`,
      `  /auth ${provider} profile ${bucket} <number|directory|--clear>`,
      `Then authenticate with:`,
      `  /auth ${provider} login ${bucket}`,
    ];

    return {
      type: 'message',
      messageType: 'info',
      content: lines.join('\n'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to discover browser profiles for ${provider}: ${msg}`,
    };
  }
}

export function handleManageBrowserProfile(
  oauthManager: OAuthManager,
  provider: string,
  bucket: string | undefined,
  selector: string | undefined,
): MessageActionReturn {
  try {
    if (!bucket) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Bucket name required for profile command. Usage: /auth <provider> profile <bucket> <number|directory|--clear>',
      };
    }

    if (!selector) {
      return {
        type: 'message',
        messageType: 'error',
        content: `A selector is required. Usage: /auth ${provider} profile ${bucket} <number|directory|--clear>`,
      };
    }

    const trimmedSelector = selector.trim();
    if (trimmedSelector === '--clear') {
      oauthManager.clearBrowserProfileAssociation(provider, bucket);
      return {
        type: 'message',
        messageType: 'info',
        content: `Cleared browser profile association for ${provider} bucket "${bucket}"`,
      };
    }

    const resolved = resolveProfileSelector(trimmedSelector);

    if (resolved === undefined) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          `Invalid profile selector: "${selector}". ` +
          `Use a number from the discovered list or a profile directory name. ` +
          `Path separators, control characters, and traversal sequences (..) are not allowed.`,
      };
    }

    oauthManager.setBrowserProfileAssociation(provider, bucket, {
      browser: BROWSER_PROFILE_ASSOCIATION_BROWSER,
      profileDirectory: resolved.profileDirectory,
      ...(resolved.displayName !== undefined
        ? { displayName: resolved.displayName }
        : {}),
    });

    const label =
      resolved.displayName !== undefined
        ? `${resolved.displayName} (${resolved.profileDirectory})`
        : resolved.profileDirectory;
    return {
      type: 'message',
      messageType: 'info',
      content: `Associated ${provider} bucket "${bucket}" with Chrome profile: ${label}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to set browser profile for ${provider}: ${msg}`,
    };
  }
}
