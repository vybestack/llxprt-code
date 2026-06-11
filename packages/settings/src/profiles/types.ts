/**
 * @plan PLAN-20260608-ISSUE1588.P05
 *
 * Profile types — migrated from core modelParams.
 * Explicit temporary duplicate; core copy remains until P09.
 *
 * Settings-owned: does NOT import core types.
 */

import { z } from 'zod';

/**
 * OAuth bucket authentication configuration
 */
export interface AuthConfig {
  type: 'oauth' | 'apikey';
  buckets?: string[];
}

/**
 * Zod schema for AuthConfig validation
 */
export const AuthConfigSchema = z.discriminatedUnion('type', [
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

/**
 * Parameters that are sent directly to the model API
 */
export interface ModelParams {
  /** Sampling temperature (0-2 for OpenAI) */
  temperature?: number;
  /** Maximum tokens to generate */
  max_tokens?: number;
  /** Nucleus sampling parameter */
  top_p?: number;
  /** Top-k sampling parameter */
  top_k?: number;
  /** Presence penalty (-2 to 2) */
  presence_penalty?: number;
  /** Frequency penalty (-2 to 2) */
  frequency_penalty?: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Additional provider-specific parameters */
  [key: string]: unknown;
}

/**
 * Settings that affect client behavior, not sent to API
 */
export interface EphemeralSettings {
  'context-limit'?: number;
  'compression-threshold'?: number;
  'auth-key'?: string;
  'auth-keyfile'?: string;
  'auth-key-name'?: string;
  'base-url'?: string;
  'sandbox-base-url'?: string;
  'requires-auth'?: boolean;
  'tool-format'?: string;
  'api-version'?: string;
  'custom-headers'?: Record<string, string>;
  'tool-output-max-items'?: number;
  'tool-output-max-tokens'?: number;
  'tool-output-truncate-mode'?: 'warn' | 'truncate' | 'sample';
  'tool-output-item-size-limit'?: number;
  'max-prompt-tokens'?: number;
  'disabled-tools'?: string[];
  'shell-replacement'?: 'allowlist' | 'all' | 'none' | boolean;
  'todo-continuation'?: boolean;
  'socket-timeout'?: number;
  'socket-keepalive'?: boolean;
  'socket-nodelay'?: boolean;
  streaming?: 'enabled' | 'disabled';
  retries?: number;
  retrywait?: number;
  'auth-retry-timeout'?: number;
  authOnly?: boolean;
  'tools.allowed'?: string[];
  'tools.disabled'?: string[];
  GOOGLE_CLOUD_PROJECT?: string;
  GOOGLE_CLOUD_LOCATION?: string;
  'include-folder-structure'?: boolean;
  'prompt-caching'?: 'off' | '5m' | '1h' | '24h';
  'enable-tool-prompts'?: boolean;
  'rate-limit-throttle'?: 'on' | 'off';
  'rate-limit-throttle-threshold'?: number;
  'rate-limit-max-wait'?: number;
  'task-default-timeout-seconds'?: number;
  'task-max-timeout-seconds'?: number;
  'shell-default-timeout-seconds'?: number;
  'shell-max-timeout-seconds'?: number;
  'shell-inactivity-timeout-seconds'?: number;
  tpm_threshold?: number;
  timeout_ms?: number;
  circuit_breaker_enabled?: boolean;
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_failure_window_ms?: number;
  circuit_breaker_recovery_timeout_ms?: number;
  'stream-options'?: Record<string, unknown>;
  maxTurnsPerPrompt?: number;
  loopDetectionEnabled?: boolean;
  toolCallLoopThreshold?: number;
  contentLoopThreshold?: number;
  dumpcontext?: 'now' | 'status' | 'on' | 'error' | 'off';
  dumponerror?: 'enabled' | 'disabled';
  emojifilter?: 'allowed' | 'auto' | 'warn' | 'error';
  'reasoning.enabled'?: boolean;
  'reasoning.effort'?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  'reasoning.maxTokens'?: number;
  'reasoning.budgetTokens'?: number;
  'reasoning.adaptiveThinking'?: boolean;
  'reasoning.includeInResponse'?: boolean;
  'reasoning.includeInContext'?: boolean;
  'reasoning.stripFromContext'?: 'all' | 'allButLast' | 'none';
  'reasoning.format'?: 'native' | 'field';
  'compression.strategy'?: string;
  'compression.profile'?: string;
  'compression.density.readWritePruning'?: boolean;
  'compression.density.fileDedupe'?: boolean;
  'compression.density.recencyPruning'?: boolean;
  'compression.density.recencyRetention'?: number;
  'compression.density.compressHeadroom'?: number;
}

/**
 * Sub-profile configuration for load balancing
 */
export interface LoadBalancerSubProfileConfig {
  name: string;
  provider: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

/**
 * Load balancer configuration
 */
export interface LoadBalancerConfig {
  strategy: 'round-robin';
  subProfiles: LoadBalancerSubProfileConfig[];
}

/**
 * Standard profile configuration (single model)
 */
export interface StandardProfile {
  version: 1;
  type?: 'standard';
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings;
  loadBalancer?: LoadBalancerConfig;
  auth?: AuthConfig;
}

/**
 * Load balancer profile configuration (multiple profiles)
 */
export interface LoadBalancerProfile {
  version: 1;
  type: 'loadbalancer';
  policy: 'roundrobin' | 'failover';
  profiles: string[];
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings;
}

/**
 * Complete profile configuration (union type)
 */
export type Profile = StandardProfile | LoadBalancerProfile;

/**
 * Type guard to check if a profile is a load balancer profile
 */
export function isLoadBalancerProfile(
  profile: Profile,
): profile is LoadBalancerProfile {
  return profile.type === 'loadbalancer';
}

/**
 * Type guard to check if a profile is a standard profile
 */
export function isStandardProfile(
  profile: Profile,
): profile is StandardProfile {
  return profile.type !== 'loadbalancer';
}

/**
 * Type guard to check if a profile has auth configuration
 */
export function hasAuthConfig(profile: Profile): boolean {
  return isStandardProfile(profile) && profile.auth !== undefined;
}

/**
 * Type guard to check if a profile is OAuth-based
 */
export function isOAuthProfile(profile: Profile): boolean {
  return isStandardProfile(profile) && profile.auth?.type === 'oauth';
}
