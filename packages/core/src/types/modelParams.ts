/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
  /** Allow command substitution ($(), <(), backticks) in shell commands */
  'shell-replacement'?: boolean;
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
  /** Anthropic prompt caching configuration: 'off' | '5m' | '1h' (default: '1h', Anthropic only) */
  'prompt-caching'?: 'off' | '5m' | '1h';
  /** Load tool-specific prompts from ~/.llxprt/prompts/tools/** (default: false) */
  'enable-tool-prompts'?: boolean;
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
