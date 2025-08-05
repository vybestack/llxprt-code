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
  /** Maximum number of files to read in ReadManyFiles (default: 50) */
  'read-many-files-max-count'?: number;
  /** Maximum estimated tokens to read in ReadManyFiles (default: 50000) */
  'read-many-files-max-tokens'?: number;
  /** How to handle exceeding limits: 'warn' | 'truncate' | 'sample' (default: 'warn') */
  'read-many-files-truncate-mode'?: 'warn' | 'truncate' | 'sample';
  /** Maximum size for individual files in ReadManyFiles (default: 524288 bytes = 512KB) */
  'read-many-files-file-size-limit'?: number;
  /** List of disabled tool names */
  'disabled-tools'?: string[];
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
