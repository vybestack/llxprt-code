/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageActionReturn, OpenDialogActionReturn } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import {
  getProtectedSettingKeys,
  isInternalSettingKey,
  type LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import { createTokenStore } from '@vybestack/llxprt-code-providers/auth.js';
import { validateBucketName, validateProfileName } from './profileSchemas.js';

/** Parsed result of a quoted profile-name argument string. */
interface QuotedProfileNameParse {
  readonly name: string;
  readonly remaining: string;
}

/**
 * Parses a string that begins with a double-quoted profile name optionally
 * followed by whitespace and additional arguments. Returns null when the input
 * does not start with a complete quoted segment, preserving the legacy
 * recognition semantics of /^"([^"]+)"(?:\s+(.+))?$/ — the closing quote must
 * be the final character or be followed by whitespace; any other adjacent
 * character causes a null result so callers fall back to unquoted handling.
 */
function parseQuotedProfileName(input: string): QuotedProfileNameParse | null {
  if (!input.startsWith('"')) {
    return null;
  }
  const closeIndex = input.indexOf('"', 1);
  if (closeIndex === -1) {
    return null;
  }
  const name = input.slice(1, closeIndex);
  if (name.length === 0) {
    return null;
  }
  const afterClose = input.slice(closeIndex + 1);
  if (afterClose.length > 0 && !/\s/.test(afterClose[0])) {
    return null;
  }
  const remaining = afterClose.trim();
  return { name, remaining };
}

export interface ContextLimitExtraction {
  readonly contextLimit: number | undefined;
  readonly profileArgs: readonly string[];
  readonly error?: MessageActionReturn;
}

function isContextLimitFlag(arg: string): boolean {
  return arg === '--context-limit' || arg.startsWith('--context-limit=');
}

export function extractExplicitLoadBalancerContextLimit(
  args: readonly string[],
): ContextLimitExtraction {
  const profileArgs: string[] = [];
  let contextLimit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const valueFromEquals = arg.startsWith('--context-limit=')
      ? arg.slice('--context-limit='.length)
      : undefined;
    const valueFromNext =
      arg === '--context-limit' ? args[index + 1] : undefined;
    const rawValue = valueFromEquals ?? valueFromNext;

    if (rawValue === undefined) {
      if (isContextLimitFlag(arg)) {
        return {
          contextLimit: undefined,
          profileArgs,
          error: {
            type: 'message',
            messageType: 'error',
            content: 'context limit must be a positive integer',
          },
        };
      }
      profileArgs.push(arg);
      continue;
    }

    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        contextLimit: undefined,
        profileArgs,
        error: {
          type: 'message',
          messageType: 'error',
          content: 'context limit must be a positive integer',
        },
      };
    }

    contextLimit = parsed;
    if (valueFromNext !== undefined) {
      index += 1;
    }
  }

  return { contextLimit, profileArgs };
}

function shouldPersistLoadBalancerEphemeral(
  protectedSettings: readonly string[],
  key: string,
  value: unknown,
): boolean {
  if (key === 'context-limit' || protectedSettings.includes(key)) {
    return false;
  }
  return !isInternalSettingKey(key) && value !== undefined && value !== null;
}

export function getAmbientLoadBalancerContextLimit(
  currentEphemerals: Record<string, unknown>,
): number | undefined {
  const value = currentEphemerals['context-limit'];
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function buildLoadBalancerEphemeralSettings(
  currentEphemerals: Record<string, unknown>,
): Record<string, unknown> {
  const protectedSettings = getProtectedSettingKeys();
  return Object.fromEntries(
    Object.entries(currentEphemerals).filter(([key, value]) =>
      shouldPersistLoadBalancerEphemeral(protectedSettings, key, value),
    ),
  );
}

export function createLoadBalancerProfileDefinition(
  policy: 'roundrobin' | 'failover',
  selectedProfiles: readonly string[],
  ephemeralSettings: Record<string, unknown>,
  contextLimit: number | undefined,
): LoadBalancerProfile {
  return {
    version: 1,
    type: 'loadbalancer',
    policy,
    profiles: [...selectedProfiles],
    ...(contextLimit !== undefined && { contextLimit }),
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings,
  };
}

async function verifyBucketsExist(
  bucketArgs: readonly string[],
): Promise<MessageActionReturn | null> {
  try {
    const runtime = getRuntimeApi();
    const status = runtime.getActiveProviderStatus();
    const provider = status.providerName;

    if (!provider) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No active provider found',
      };
    }

    const tokenStore = createTokenStore();
    const availableBuckets = await tokenStore.listBuckets(provider);

    for (const bucket of bucketArgs) {
      if (!availableBuckets.includes(bucket)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Bucket '${bucket}' not found for provider ${provider}. Use /auth ${provider} login ${bucket}`,
        };
      }
    }
    return null;
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to validate buckets: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateBucketArgs(
  bucketArgs: readonly string[],
): MessageActionReturn | null {
  for (const bucket of bucketArgs) {
    const validation = validateBucketName(bucket);
    if (!validation.valid) {
      return {
        type: 'message',
        messageType: 'error',
        content: validation.error ?? 'Invalid bucket name',
      };
    }
  }
  return null;
}

export async function saveModelProfile(
  parts: readonly string[],
): Promise<MessageActionReturn | OpenDialogActionReturn> {
  if (parts.length < 2) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /profile save model "<profile-name>" [bucket1] [bucket2] ...',
    };
  }

  let profileName: string;
  let bucketArgs: string[] = [];

  // Check if profile name is quoted
  const joined = parts.slice(1).join(' ');
  const quotedParse = parseQuotedProfileName(joined);
  if (quotedParse !== null) {
    profileName = quotedParse.name;
    bucketArgs = quotedParse.remaining.split(/\s+/).filter((b) => b.length > 0);
  } else {
    profileName = parts[1];
    bucketArgs = parts.slice(2);
  }

  if (!profileName) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /profile save model "<profile-name>" [bucket1] [bucket2] ...',
    };
  }

  const nameError = validateProfileName(profileName);
  if (nameError) {
    return nameError;
  }

  const bucketValidationError = validateBucketArgs(bucketArgs);
  if (bucketValidationError) {
    return bucketValidationError;
  }

  if (bucketArgs.length > 0) {
    const bucketError = await verifyBucketsExist(bucketArgs);
    if (bucketError) {
      return bucketError;
    }
  }

  try {
    const runtime = getRuntimeApi();
    const authConfig =
      bucketArgs.length > 0
        ? { auth: { type: 'oauth' as const, buckets: bucketArgs } }
        : undefined;

    await runtime.saveProfileSnapshot(profileName, authConfig);
    return {
      type: 'message',
      messageType: 'info',
      content: `Profile '${profileName}' saved`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to save profile: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function findMissingProfile(
  selectedProfiles: readonly string[],
  availableProfiles: readonly string[],
): string | null {
  for (const profileName of selectedProfiles) {
    if (!availableProfiles.includes(profileName)) {
      return profileName;
    }
  }
  return null;
}

export async function saveLoadBalancerProfile(
  parts: readonly string[],
): Promise<MessageActionReturn | OpenDialogActionReturn> {
  if (parts.length < 5) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /profile save loadbalancer <lb-name> <roundrobin|failover> [--context-limit N] <profile1> <profile2> [...]',
    };
  }

  const lbProfileName = parts[1];

  const nameError = validateProfileName(lbProfileName);
  if (nameError) {
    return nameError;
  }

  const policyInput = parts[2]?.toLowerCase();

  if (policyInput !== 'failover' && policyInput !== 'roundrobin') {
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid policy "${parts[2]}". Must be "roundrobin" or "failover".`,
    };
  }

  const policy: 'roundrobin' | 'failover' = policyInput;

  const explicitContextLimit = extractExplicitLoadBalancerContextLimit(
    parts.slice(3),
  );
  if (explicitContextLimit.error !== undefined) {
    return explicitContextLimit.error;
  }

  const selectedProfiles = explicitContextLimit.profileArgs.filter(
    (p) => p.length > 0,
  );

  if (selectedProfiles.length < 2) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Load balancer profile requires at least 2 profiles',
    };
  }

  try {
    const runtime = getRuntimeApi();
    const availableProfiles = await runtime.listSavedProfiles();

    const missing = findMissingProfile(selectedProfiles, availableProfiles);
    if (missing !== null) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Profile ${missing} does not exist`,
      };
    }

    const currentEphemerals = runtime.getEphemeralSettings();
    const filteredEphemerals =
      buildLoadBalancerEphemeralSettings(currentEphemerals);
    const contextLimit =
      explicitContextLimit.contextLimit ??
      getAmbientLoadBalancerContextLimit(currentEphemerals);
    const lbProfile = createLoadBalancerProfileDefinition(
      policy,
      selectedProfiles,
      filteredEphemerals,
      contextLimit,
    );

    await runtime.saveLoadBalancerProfile(lbProfileName, lbProfile);

    return {
      type: 'message',
      messageType: 'info',
      content: `Load balancer profile '${lbProfileName}' saved with ${selectedProfiles.length} profiles (policy: ${policy})`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to save load balancer profile: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
