/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isLoadBalancerProfile,
  type Profile,
  type ProfileManager,
} from '@vybestack/llxprt-code-settings';
import type { ProviderActivationIntent } from '../api/config-types.js';
import { expandTilde, getStringSetting } from './subagentSettingsAccess.js';

/**
 * Resolution of a subagent's profile into the two profiles the runtime needs:
 *
 * - `effectiveProfile` — the profile as authored (for a load balancer this is
 *   the load-balancer profile itself, so its failover/round-robin routing and
 *   load-balancer-scoped ephemerals are preserved downstream).
 * - `primaryProfile` — a CONCRETE profile that always carries a non-empty
 *   `provider`/`model` (for a load balancer this is the first referenced member
 *   profile). This is used for upfront member validation only; the actual
 *   load-balancer runtime activates the effective profile so failover is
 *   preserved.
 *
 * For a standard profile both fields reference the same profile.
 */
export interface RuntimeProfileResolution {
  effectiveProfile: Profile;
  primaryProfile: Profile;
}

/**
 * Resolves a subagent profile into its {@link RuntimeProfileResolution}.
 *
 * A load-balancer profile (`type: 'loadbalancer'`) carries an empty
 * `provider`/`model` of its own; the concrete values live on the referenced
 * member profiles. This loads and validates every referenced member (rejecting
 * an empty list and nested load balancers), preserves the load-balancer profile
 * as the effective profile so its failover routing survives, and promotes the
 * first concrete member to the primary profile for concrete provider/model
 * validation.
 */
export async function resolveRuntimeProfile(
  profile: Profile,
  profileManager: ProfileManager,
): Promise<RuntimeProfileResolution> {
  if (!isLoadBalancerProfile(profile)) {
    return { effectiveProfile: profile, primaryProfile: profile };
  }

  if (profile.profiles.length === 0) {
    throw new Error(
      'Load balancer subagent profile must reference at least one profile.',
    );
  }

  const subProfiles = await Promise.all(
    profile.profiles.map(async (name) => {
      try {
        return {
          name,
          profile: await profileManager.loadProfile(name),
        };
      } catch (error) {
        throw new Error(
          `Failed to resolve load balancer subagent profile member '${name}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }),
  );
  for (const { name, profile: subProfile } of subProfiles) {
    if (isLoadBalancerProfile(subProfile)) {
      throw new Error(
        `Load balancer subagent profile cannot use nested load balancer profile '${name}'.`,
      );
    }
    if (subProfile.provider.trim().length === 0) {
      throw new Error(
        `Load balancer subagent profile member '${name}' must define a non-empty provider.`,
      );
    }
    if (subProfile.model.trim().length === 0) {
      throw new Error(
        `Load balancer subagent profile member '${name}' must define a non-empty model.`,
      );
    }
  }

  const { profile: primaryProfile } = subProfiles[0];

  return {
    effectiveProfile: profile,
    primaryProfile,
  };
}

/**
 * Extracts the credential/endpoint ephemerals (base-url, auth-key,
 * auth-key-name, auth-keyfile) from a profile into the `cliOverrides` shape
 * {@link ProviderActivationIntent} applies BEFORE the provider switch. Mirrors
 * the CLI bootstrap's runtime provider overrides so an isolated subagent
 * runtime reaches the SAME endpoint/auth the parent would for the same profile.
 *
 * Without this, a profile like `zai` (provider 'anthropic', base-url
 * https://api.z.ai/api/anthropic) would fall back to the provider default
 * (api.anthropic.com), its z.ai key would never authenticate, and the request
 * would stall until the 5-minute first-response timeout — the subagent then
 * returns an empty result (Issue #2410).
 */
export function buildActivationCliOverrides(
  profile: Profile,
): ProviderActivationIntent['cliOverrides'] {
  const baseUrl = getStringSetting(profile.ephemeralSettings, ['base-url']);
  const key = getStringSetting(profile.ephemeralSettings, ['auth-key']);
  const keyName = getStringSetting(profile.ephemeralSettings, [
    'auth-key-name',
  ]);
  const keyfileRaw = getStringSetting(profile.ephemeralSettings, [
    'auth-keyfile',
  ]);
  const keyfile =
    keyfileRaw !== undefined ? expandTilde(keyfileRaw) : undefined;

  const overrides: {
    key?: string;
    keyfile?: string;
    keyName?: string;
    baseUrl?: string;
  } = {};
  if (key !== undefined) {
    overrides.key = key;
  }
  if (keyfile !== undefined) {
    overrides.keyfile = keyfile;
  }
  if (keyName !== undefined) {
    overrides.keyName = keyName;
  }
  if (baseUrl !== undefined) {
    overrides.baseUrl = baseUrl;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
