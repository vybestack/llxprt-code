/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandArgumentSchema,
  type CompleterFn,
} from './schema/types.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
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

export async function listProfiles(runtimeApi: RuntimeApi): Promise<string[]> {
  return runtimeApi.listSavedProfiles();
}

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
  hint: 'ESC to finish selection',
  next: depth < 20 ? [createBucketEntry(depth + 1)] : undefined,
});

const bucketSchema: CommandArgumentSchema = [createBucketEntry(0)];

const profileSaveSchema: CommandArgumentSchema = [
  {
    kind: 'literal',
    value: 'model',
    description: 'Save current model configuration',
    next: [
      {
        kind: 'value',
        name: 'profile-name',
        description: 'Enter profile name',
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

const profileLoadSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to load',
  },
];

const profileDeleteSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to delete',
  },
];

const profileSetDefaultSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Set default profile or choose none',
  },
];

const profileShowSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to view',
  },
];

const profileEditSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile to edit',
  },
];

export interface ProfileSchemaOperations {
  listProfiles(): Promise<readonly string[]>;
  getActiveProviderName(): string | undefined;
  listBuckets(provider: string): Promise<readonly string[]>;
}

export interface ProfileSchemas {
  profileSaveSchema: CommandArgumentSchema;
  profileLoadSchema: CommandArgumentSchema;
  profileDeleteSchema: CommandArgumentSchema;
  profileSetDefaultSchema: CommandArgumentSchema;
  profileShowSchema: CommandArgumentSchema;
  profileEditSchema: CommandArgumentSchema;
}

function bindSchema(
  schema: CommandArgumentSchema,
  completerFor: (name: string) => CompleterFn | undefined,
): CommandArgumentSchema {
  return schema.map((node) => {
    if (node.kind !== 'value')
      return {
        ...node,
        ...(node.next !== undefined && {
          next: bindSchema(node.next, completerFor),
        }),
      };
    return {
      ...node,
      completer: completerFor(node.name),
      ...(node.next !== undefined && {
        next: bindSchema(node.next, completerFor),
      }),
    };
  });
}

export function createProfileSchemas(
  operations: ProfileSchemaOperations,
  readFuzzyFiltering: () => boolean,
): ProfileSchemas {
  const profileCompleter: CompleterFn = withFuzzyFilter(
    async () =>
      (await operations.listProfiles()).map((profile) => ({
        value: profile,
        description: profileSuggestionDescription,
      })),
    readFuzzyFiltering,
  );
  const loadBalancerMemberCompleter: CompleterFn = withFuzzyFilter(
    async (_context, _partial, tokens) => {
      const alreadySelected = tokens.tokens.slice(4).filter(Boolean);
      return (await operations.listProfiles())
        .filter((profile) => !alreadySelected.includes(profile))
        .map((profile) => ({
          value: profile,
          description: 'Add to load balancer',
        }));
    },
    readFuzzyFiltering,
  );
  const bucketNameCompleter: CompleterFn = withFuzzyFilter(
    async (_context, _partial, tokens) => {
      const provider = operations.getActiveProviderName();
      if (provider === undefined) return [];
      const alreadySelected = tokens.tokens.slice(3).filter(Boolean);
      return (await operations.listBuckets(provider))
        .filter((bucket) => !alreadySelected.includes(bucket))
        .map((bucket) => ({
          value: bucket,
          description: 'Add bucket to profile',
        }));
    },
    readFuzzyFiltering,
  );
  const defaultProfileCompleter: CompleterFn = withFuzzyFilter(
    async () =>
      ['none', ...(await operations.listProfiles())].map((option) => ({
        value: option,
        description:
          option === 'none'
            ? 'Clear default profile'
            : profileSuggestionDescription,
      })),
    readFuzzyFiltering,
  );

  const profileCompleterFor = (name: string): CompleterFn | undefined => {
    if (name.startsWith('bucket')) return bucketNameCompleter;
    if (/^profile\d+$/.test(name)) return loadBalancerMemberCompleter;
    return profileCompleter;
  };
  const defaultSchema = profileSetDefaultSchema.map((node) =>
    node.kind === 'value'
      ? { ...node, completer: defaultProfileCompleter }
      : node,
  );

  return {
    profileSaveSchema: bindSchema(profileSaveSchema, profileCompleterFor),
    profileLoadSchema: bindSchema(profileLoadSchema, profileCompleterFor),
    profileDeleteSchema: bindSchema(profileDeleteSchema, profileCompleterFor),
    profileSetDefaultSchema: defaultSchema,
    profileShowSchema: bindSchema(profileShowSchema, profileCompleterFor),
    profileEditSchema: bindSchema(profileEditSchema, profileCompleterFor),
  };
}

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
