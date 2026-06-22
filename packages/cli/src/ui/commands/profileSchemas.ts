/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandArgumentSchema,
  type CompleterFn,
} from './schema/types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { createTokenStore } from '@vybestack/llxprt-code-providers/auth.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type { MessageActionReturn } from './types.js';

const profileSuggestionDescription = 'Saved profile';

export const RESERVED_BUCKET_NAMES = [
  'login',
  'logout',
  'status',
  'switch',
  '--all',
];

export function validateBucketName(bucket: string): {
  valid: boolean;
  error?: string;
} {
  const invalidChars = /[:/\\<>"|?*]/;
  if (invalidChars.test(bucket)) {
    return {
      valid: false,
      error: `Bucket name "${bucket}" contains unsafe characters. Cannot contain: : / \\ < > " | ? *`,
    };
  }

  if (RESERVED_BUCKET_NAMES.includes(bucket.toLowerCase())) {
    return {
      valid: false,
      error: `"${bucket}" is a reserved word and cannot be used as a bucket name`,
    };
  }

  return { valid: true };
}

export async function listProfiles(): Promise<string[]> {
  return getRuntimeApi().listSavedProfiles();
}

export const profileNameCompleter: CompleterFn = withFuzzyFilter(async () => {
  try {
    const profiles = await listProfiles();
    return profiles.map((profile) => ({
      value: profile,
      description: profileSuggestionDescription,
    }));
  } catch {
    return [];
  }
});

const lbMemberProfileCompleter: CompleterFn = withFuzzyFilter(
  async (_ctx, _partial, tokens) => {
    try {
      const profiles = await listProfiles();
      // tokens.tokens format: ["save", "loadbalancer", "lb-name", "policy", "prof1", "prof2", ...]
      // Skip first 4 tokens (save, loadbalancer, lb-name, policy) to get already selected profiles
      const alreadySelected = tokens.tokens
        .slice(4)
        .filter((p) => p.length > 0);
      const available = profiles.filter((p) => !alreadySelected.includes(p));
      return available.map((profile) => ({
        value: profile,
        description: 'Add to load balancer',
      }));
    } catch {
      return [];
    }
  },
);

const bucketCompleter: CompleterFn = withFuzzyFilter(
  async (_ctx, _partial, tokens) => {
    try {
      const runtime = getRuntimeApi();
      const status = runtime.getActiveProviderStatus();
      const provider = status.providerName;

      if (!provider) {
        return [];
      }

      // @plan:PLAN-20250214-CREDPROXY.P33
      const tokenStore = createTokenStore();
      const buckets = await tokenStore.listBuckets(provider);

      // tokens.tokens format: ["save", "model", "profile-name", "bucket1", "bucket2", ...]
      // Skip first 3 tokens (save, model, profile-name) to get already selected buckets
      const alreadySelected = tokens.tokens
        .slice(3)
        .filter((b) => b.length > 0);
      const available = buckets.filter((b) => !alreadySelected.includes(b));

      return available.map((bucket) => ({
        value: bucket,
        description: 'Add bucket to profile',
      }));
    } catch {
      return [];
    }
  },
);

// Recursive schema for unlimited profile selection
const createLbMemberProfileEntry = (
  depth: number,
): CommandArgumentSchema[number] => ({
  kind: 'value',
  name: depth === 0 ? 'profile1' : `profile${depth + 1}`,
  description:
    depth === 0
      ? 'Select first profile'
      : 'Add another profile (ESC to finish)',
  completer: lbMemberProfileCompleter,
  hint: 'ESC to finish selection',
  next: depth < 20 ? [createLbMemberProfileEntry(depth + 1)] : undefined,
});

const lbMemberProfileSchema: CommandArgumentSchema = [
  createLbMemberProfileEntry(0),
];

// Recursive schema for unlimited bucket selection
const createBucketEntry = (depth: number): CommandArgumentSchema[number] => ({
  kind: 'value',
  name: depth === 0 ? 'bucket1' : `bucket${depth + 1}`,
  description:
    depth === 0
      ? 'Select first bucket (optional)'
      : 'Add another bucket (ESC to finish)',
  completer: bucketCompleter,
  hint: 'ESC to finish selection',
  next: depth < 20 ? [createBucketEntry(depth + 1)] : undefined,
});

const bucketSchema: CommandArgumentSchema = [createBucketEntry(0)];

export const profileSaveSchema: CommandArgumentSchema = [
  {
    kind: 'literal',
    value: 'model',
    description: 'Save current model configuration',
    next: [
      {
        kind: 'value',
        name: 'profile-name',
        description: 'Enter profile name',
        completer: profileNameCompleter,
        next: bucketSchema,
      },
    ],
  },
  {
    kind: 'literal',
    value: 'loadbalancer',
    description: 'Create a load balancer profile',
    next: [
      {
        kind: 'value',
        name: 'lb-name',
        description: 'Enter load balancer profile name',
        completer: profileNameCompleter,
        next: [
          {
            kind: 'literal',
            value: 'roundrobin',
            description: 'Distribute requests across backends in sequence',
            next: lbMemberProfileSchema,
          },
          {
            kind: 'literal',
            value: 'failover',
            description: 'Try backends sequentially until one succeeds',
            next: lbMemberProfileSchema,
          },
        ],
      },
    ],
  },
];

export const profileLoadSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to load',
    completer: profileNameCompleter,
  },
];

export const profileDeleteSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to delete',
    completer: profileNameCompleter,
  },
];

export const profileSetDefaultSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Set default profile or choose none',
    completer: withFuzzyFilter(async () => {
      try {
        const profiles = await listProfiles();
        const candidates = ['none', ...profiles];
        return candidates.map((option) => ({
          value: option,
          description:
            option === 'none'
              ? 'Clear default profile'
              : profileSuggestionDescription,
        }));
      } catch {
        return [];
      }
    }),
  },
];

export const profileShowSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to view',
    completer: profileNameCompleter,
  },
];

export const profileEditSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to edit',
    completer: profileNameCompleter,
  },
];

export function extractProfileName(trimmedArgs: string): string {
  const profileNameMatch = trimmedArgs.match(/^"([^"]+)"$/);
  return profileNameMatch ? profileNameMatch[1] : trimmedArgs;
}

export function validateProfileName(
  profileName: string,
): MessageActionReturn | null {
  if (profileName.includes('/') || profileName.includes('\\')) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Profile name cannot contain path separators',
    };
  }
  return null;
}
