/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * OAuth bucket authentication configuration
 * @plan PLAN-20251213issue490 Phase 1
 */
export interface AuthConfig {
  type: 'oauth' | 'apikey';
  buckets?: string[];
}

/**
 * Zod schema for AuthConfig validation
 * @plan PLAN-20251213issue490 Phase 1
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
  /** Maximum context window in tokens */
  'context-limit'?: number;
  /** When to compress history (0-1) */
  'compression-threshold'?: number;
  /** API authentication key */
  'auth-key'?: string;
  /** Path to key file */
  'auth-keyfile'?: string;
  /** API base URL */
  'base-url'?: string;
  /** Tool format override */
  'tool-format'?: string;
  /** API version (for Azure) */
  'api-version'?: string;
  /** Custom HTTP headers */
  'custom-headers'?: Record<string, string>;
  /** Maximum number of items/files/matches returned by tools (default: 50) */
  'tool-output-max-items'?: number;
  /** Maximum estimated tokens in tool output (default: 50000) */
  'tool-output-max-tokens'?: number;
  /** How to handle exceeding limits: 'warn' | 'truncate' | 'sample' (default: 'warn') */
  'tool-output-truncate-mode'?: 'warn' | 'truncate' | 'sample';
  /** Maximum size per item/file in bytes (default: 524288 bytes = 512KB) */
  'tool-output-item-size-limit'?: number;
  /** Maximum tokens allowed in any prompt sent to LLM (default: 200000) */
  'max-prompt-tokens'?: number;
  /** List of disabled tool names */
  'disabled-tools'?: string[];
  /**
   * Control command substitution ($(), <(), backticks) in shell commands.
   * - 'allowlist': Allow substitution, validate inner commands against coreTools (default, matches upstream)
   * - 'all': Allow all substitution unconditionally (same as legacy `true`)
   * - 'none': Block all substitution (same as legacy `false`)
   * - true/false: Legacy boolean values for backward compatibility
   */
  'shell-replacement'?: 'allowlist' | 'all' | 'none' | boolean;
  /** Enable todo continuation after stream completion (default: true) */
  'todo-continuation'?: boolean;
  /** Socket timeout in milliseconds for local AI servers */
  'socket-timeout'?: number;
  /** Enable socket keep-alive for local AI servers */
  'socket-keepalive'?: boolean;
  /** Enable TCP_NODELAY for local AI servers */
  'socket-nodelay'?: boolean;
  /** Enable streaming responses from providers */
  streaming?: 'enabled' | 'disabled';
  /** Maximum number of retry attempts for API calls */
  retries?: number;
  /** Initial delay in milliseconds between retry attempts */
  retrywait?: number;
  /** Force OAuth authentication and ignore API keys/env vars */
  authOnly?: boolean;
  /** Explicit allow-list of tool names */
  'tools.allowed'?: string[];
  /** Explicit disable-list of tool names */
  'tools.disabled'?: string[];
  /** Google Cloud project identifier for Gemini auth */
  GOOGLE_CLOUD_PROJECT?: string;
  /** Google Cloud location identifier for Gemini auth */
  GOOGLE_CLOUD_LOCATION?: string;
  /** Whether to include folder structure in system prompts (default: false for better cache hit rates) */
  'include-folder-structure'?: boolean;
  /** Anthropic/OpenAI prompt caching configuration: 'off' | '5m' | '1h' | '24h' (default: '1h') */
  'prompt-caching'?: 'off' | '5m' | '1h' | '24h';
  /** Load tool-specific prompts from ~/.llxprt/prompts/tools/** (default: false) */
  'enable-tool-prompts'?: boolean;

  /** Proactive rate limit throttling (on/off) */
  'rate-limit-throttle'?: 'on' | 'off';
  /** Percentage threshold for rate limit throttling (1-100) */
  'rate-limit-throttle-threshold'?: number;
  /** Maximum wait time in milliseconds for rate limit throttling */
  'rate-limit-max-wait'?: number;

  /** Default timeout in seconds for task tool executions */
  'task-default-timeout-seconds'?: number;
  /** Maximum allowed timeout in seconds for task tool executions */
  'task-max-timeout-seconds'?: number;
  /** Default timeout in seconds for shell command executions */
  'shell-default-timeout-seconds'?: number;
  /** Maximum allowed timeout in seconds for shell command executions */
  'shell-max-timeout-seconds'?: number;

  // Load balancer advanced failover settings (Phase 3, Issue #489)
  /** Minimum tokens per minute before triggering failover */
  tpm_threshold?: number;
  /** Maximum request duration in milliseconds before timeout */
  timeout_ms?: number;
  /** Enable circuit breaker pattern for failing backends */
  circuit_breaker_enabled?: boolean;
  /** Number of failures before opening circuit */
  circuit_breaker_failure_threshold?: number;
  /** Time window for counting failures in milliseconds */
  circuit_breaker_failure_window_ms?: number;
  /** Cooldown period before retrying after circuit opens in milliseconds */
  circuit_breaker_recovery_timeout_ms?: number;

  // Additional settings from registry
  /** OpenAI stream options */
  'stream-options'?: Record<string, unknown>;
  /** Maximum number of turns allowed per prompt before stopping (default: -1 for unlimited) */
  maxTurnsPerPrompt?: number;
  /** Enable/disable all loop detection (default: true) */
  loopDetectionEnabled?: boolean;
  /** Number of identical tool calls before triggering loop detection (default: 50, -1 = unlimited) */
  toolCallLoopThreshold?: number;
  /** Number of content chunk repetitions before triggering loop detection (default: 50, -1 = unlimited) */
  contentLoopThreshold?: number;
  /** Control context dumping (now/status/on/error/off) */
  dumpcontext?: 'now' | 'status' | 'on' | 'error' | 'off';
  /** Dump API request body to ~/.llxprt/dumps/ on errors (enabled/disabled) */
  dumponerror?: 'enabled' | 'disabled';
  /** Emoji filter mode (allowed/auto/warn/error) */
  emojifilter?: 'allowed' | 'auto' | 'warn' | 'error';

  // Reasoning settings (nested under reasoning.* in registry)
  /** Enable thinking/reasoning for models that support it */
  'reasoning.enabled'?: boolean;
  /** How much the model should think before responding */
  'reasoning.effort'?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Maximum token budget for reasoning */
  'reasoning.maxTokens'?: number;
  /** Token budget for reasoning (Anthropic-specific) */
  'reasoning.budgetTokens'?: number;
  /** Enable adaptive thinking for Anthropic Opus 4.6+ */
  'reasoning.adaptiveThinking'?: boolean;
  /** Show thinking blocks in UI output */
  'reasoning.includeInResponse'?: boolean;
  /** Keep thinking in conversation history */
  'reasoning.includeInContext'?: boolean;
  /** Remove thinking blocks from context (all/allButLast/none) */
  'reasoning.stripFromContext'?: 'all' | 'allButLast' | 'none';
  /** API format for reasoning (native/field) */
  'reasoning.format'?: 'native' | 'field';
}

/**
 * Sub-profile configuration for load balancing (NEW ARCHITECTURE)
 * @plan PLAN-20251211issue486b
 */
export interface LoadBalancerSubProfileConfig {
  name: string;
  provider: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

/**
 * Load balancer configuration (NEW ARCHITECTURE)
 * @plan PLAN-20251211issue486b
 */
export interface LoadBalancerConfig {
  strategy: 'round-robin';
  subProfiles: LoadBalancerSubProfileConfig[];
}

/**
 * Standard profile configuration (single model)
 */
export interface StandardProfile {
  /** Profile format version */
  version: 1;
  /** Profile type (optional for backward compatibility) */
  type?: 'standard';
  /** Provider name */
  provider: string;
  /** Model name */
  model: string;
  /** Model parameters */
  modelParams: ModelParams;
  /** Ephemeral settings */
  ephemeralSettings: EphemeralSettings;
  /** Load balancer configuration (NEW ARCHITECTURE - optional) */
  loadBalancer?: LoadBalancerConfig;
  /** OAuth bucket authentication configuration (optional) */
  auth?: AuthConfig;
}

/**
 * Load balancer profile configuration (multiple profiles)
 */
export interface LoadBalancerProfile {
  /** Profile format version */
  version: 1;
  /** Profile type */
  type: 'loadbalancer';
  /** Load balancing policy */
  policy: 'roundrobin' | 'failover';
  /** List of profile names to load balance across */
  profiles: string[];
  /** Provider name (empty for load balancer) */
  provider: string;
  /** Model name (empty for load balancer) */
  model: string;
  /** Model parameters (empty for load balancer) */
  modelParams: ModelParams;
  /** Ephemeral settings (empty for load balancer) */
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
 * @plan PLAN-20251213issue490 Phase 1
 */
export function hasAuthConfig(profile: Profile): boolean {
  return isStandardProfile(profile) && profile.auth !== undefined;
}

/**
 * Type guard to check if a profile is OAuth-based
 * @plan PLAN-20251213issue490 Phase 1
 */
export function isOAuthProfile(profile: Profile): boolean {
  return isStandardProfile(profile) && profile.auth?.type === 'oauth';
}
