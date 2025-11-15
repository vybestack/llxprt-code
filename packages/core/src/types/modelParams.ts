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
}

/**
 * Complete profile configuration
 */
export interface Profile {
  /** Profile format version */
  version: 1;
  /** Provider name */
  provider: string;
  /** Model name */
  model: string;
  /** Model parameters */
  modelParams: ModelParams;
  /** Ephemeral settings */
  ephemeralSettings: EphemeralSettings;
}
