/**
 * @plan PLAN-20260608-ISSUE1588.P05
 */

import { z } from 'zod';
import type {
  EphemeralSettings,
  LoadBalancerProfile,
  ModelParams,
  Profile,
  StandardProfile,
} from '../profiles/types.js';

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);
const promptCachingValues = ['off', '5m', '1h', '24h'] as const;

export function isDangerousPropertyKey(key: string): boolean {
  return dangerousKeys.has(key);
}

type PromptCachingValue = (typeof promptCachingValues)[number];

export type TrustedProviderRecord = Record<string, unknown> & {
  readonly __brand: 'TrustedProviderRecord';
};

export type TrustedProvidersMap = Record<
  string,
  TrustedProviderRecord | undefined
>;

export interface TrustedProfileImport {
  defaultProvider?: string;
  providers: TrustedProvidersMap;
  tools: {
    allowed: string[];
    disabled: string[];
  };
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasDangerousKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasDangerousKey(entry));
  }
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([key, entry]) => dangerousKeys.has(key) || hasDangerousKey(entry),
  );
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && !hasDangerousKey(value);
}

const trustedProviderRecordSchema =
  z.custom<TrustedProviderRecord>(isSafeRecord);

const modelParamsSchema = z.custom<ModelParams>(isSafeRecord);
const ephemeralSettingsSchema = z.custom<EphemeralSettings>(isSafeRecord);

const authConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('oauth'),
    buckets: z.array(z.string()).optional(),
  }),
  z
    .object({
      type: z.literal('apikey'),
    })
    .strict(),
]);

const loadBalancerConfigSchema = z.object({
  strategy: z.literal('round-robin'),
  subProfiles: z.array(
    z.object({
      name: z.string(),
      provider: z.string(),
      model: z.string().optional(),
      baseURL: z.string().optional(),
      apiKey: z.string().optional(),
    }),
  ),
});

const standardProfileSchema: z.ZodType<StandardProfile> = z
  .object({
    version: z.literal(1),
    type: z.literal('standard').optional(),
    provider: z.string().min(1),
    model: z.string().min(1),
    modelParams: modelParamsSchema,
    ephemeralSettings: ephemeralSettingsSchema,
    loadBalancer: loadBalancerConfigSchema.optional(),
    auth: authConfigSchema.optional(),
  })
  .passthrough();

const loadBalancerProfileSchema: z.ZodType<LoadBalancerProfile> = z
  .object({
    version: z.literal(1),
    type: z.literal('loadbalancer'),
    policy: z.union([z.literal('roundrobin'), z.literal('failover')]),
    profiles: z.array(z.string().min(1)).min(1),
    contextLimit: z.number().optional(),
    provider: z.string(),
    model: z.string(),
    modelParams: modelParamsSchema,
    ephemeralSettings: ephemeralSettingsSchema,
  })
  .passthrough();

function isMissingVersion(version: unknown): boolean {
  if (version === null || version === undefined) {
    return true;
  }
  if (version === 0 || version === false) {
    return true;
  }
  if (typeof version === 'number' && Number.isNaN(version)) {
    return true;
  }
  return false;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((name) => String(name)) : [];
}

function parseTrustedProviders(value: unknown): TrustedProvidersMap {
  const providers: TrustedProvidersMap = {};
  if (!isPlainObject(value)) {
    return providers;
  }
  for (const [provider, settings] of Object.entries(value)) {
    if (dangerousKeys.has(provider)) {
      continue;
    }
    const parsed = trustedProviderRecordSchema.safeParse(settings);
    if (parsed.success) {
      providers[provider] = parsed.data;
    }
  }
  return providers;
}

export function parseProviderSettingsRecord(
  value: unknown,
): TrustedProviderRecord | undefined {
  const parsed = trustedProviderRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function createTrustedProviderRecord(): TrustedProviderRecord {
  return trustedProviderRecordSchema.parse({});
}

export function parseProfileImport(
  input: unknown,
): TrustedProfileImport | null {
  const parsed = z
    .object({
      defaultProvider: z.string().optional(),
      providers: z.unknown().optional(),
      tools: z
        .object({
          allowed: z.unknown().optional(),
          disabled: z.unknown().optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .safeParse(input);

  if (!parsed.success) {
    return null;
  }

  return {
    defaultProvider: parsed.data.defaultProvider,
    providers: parseTrustedProviders(parsed.data.providers),
    tools: {
      allowed: asStringArray(parsed.data.tools?.allowed),
      disabled: asStringArray(parsed.data.tools?.disabled),
    },
  };
}

export function parseLoadBalancerProfile(
  name: string,
  input: unknown,
): LoadBalancerProfile {
  if (!isPlainObject(input) || input.type !== 'loadbalancer') {
    throw new Error(
      `LoadBalancer profile '${name}' must reference at least one profile`,
    );
  }
  if (input.version !== 1) {
    throw new Error('unsupported profile version');
  }
  if (
    !Array.isArray(input.profiles) ||
    input.profiles.length === 0 ||
    !input.profiles.every(
      (profile) => typeof profile === 'string' && profile !== '',
    )
  ) {
    throw new Error(
      `LoadBalancer profile '${name}' must reference at least one profile`,
    );
  }
  return loadBalancerProfileSchema.parse(input);
}

export function parseProfile(input: unknown): Profile {
  if (!isPlainObject(input)) {
    throw new Error('missing required fields');
  }

  if (input.type === 'loadbalancer') {
    return parseLoadBalancerProfile('', input);
  }

  if (isMissingVersion(input.version)) {
    throw new Error('missing required fields');
  }
  if (typeof input.provider !== 'string' || input.provider === '') {
    throw new Error('missing required fields');
  }
  if (typeof input.model !== 'string' || input.model === '') {
    throw new Error('missing required fields');
  }
  if (!modelParamsSchema.safeParse(input.modelParams).success) {
    throw new Error('missing required fields');
  }
  if (!ephemeralSettingsSchema.safeParse(input.ephemeralSettings).success) {
    throw new Error('missing required fields');
  }
  if (input.version !== 1) {
    throw new Error('unsupported profile version');
  }

  return standardProfileSchema.parse(input);
}

function isPromptCachingValue(value: unknown): value is PromptCachingValue {
  return promptCachingValues.some((option) => option === value);
}

export function parsePromptCaching(
  value: unknown,
): EphemeralSettings['prompt-caching'] {
  return isPromptCachingValue(value) ? value : undefined;
}
