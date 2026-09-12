/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Implementation-neutral structural mirror of the v1 profile document format.
 *
 * This contract describes only the persisted profile document surface that core
 * consumes. Settings-owned profile types are structurally compatible with it without
 * importing them, preserving the core -> providers/settings dependency direction.
 * Type guards perform structural checks only: no assertions, no `any`.
 */

/**
 * Authentication configuration for a standard profile document.
 */
export type ProfileAuthConfig =
  | { type: 'oauth'; buckets?: readonly string[] }
  | { type: 'apikey' };

/**
 * Standard (single model) profile document.
 */
export interface StandardProfileDocument {
  version: 1;
  type?: 'standard';
  provider: string;
  model: string;
  modelParams: Readonly<Record<string, unknown>>;
  ephemeralSettings: Readonly<Record<string, unknown>>;
  auth?: ProfileAuthConfig;
}

/**
 * Load balancer profile document (multiple profiles).
 */
export interface LoadBalancerProfileDocument {
  version: 1;
  type: 'loadbalancer';
  policy: 'roundrobin' | 'failover';
  profiles: readonly string[];
  contextLimit?: number;
  provider: string;
  model: string;
  modelParams: Readonly<Record<string, unknown>>;
  ephemeralSettings: Readonly<Record<string, unknown>>;
}

/**
 * Complete profile document (union type).
 */
export type ProfileDocument =
  | StandardProfileDocument
  | LoadBalancerProfileDocument;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isProfileAuthConfig(value: unknown): value is ProfileAuthConfig {
  if (!isRecord(value)) {
    return false;
  }
  if (value['type'] === 'oauth') {
    if ('buckets' in value && value['buckets'] !== undefined) {
      return (
        Array.isArray(value['buckets']) && value['buckets'].every(isString)
      );
    }
    return true;
  }
  return value['type'] === 'apikey';
}

function hasBaseDocumentShape(value: Record<string, unknown>): boolean {
  if (value['version'] !== 1) {
    return false;
  }
  if (!isString(value['provider']) || !isString(value['model'])) {
    return false;
  }
  if (
    !isRecord(value['modelParams']) ||
    !isRecord(value['ephemeralSettings'])
  ) {
    return false;
  }
  if (
    'auth' in value &&
    value['auth'] !== undefined &&
    !isProfileAuthConfig(value['auth'])
  ) {
    return false;
  }
  return true;
}

/**
 * Structural type guard for a standard profile document.
 */
export function isStandardProfileDocument(
  value: unknown,
): value is StandardProfileDocument {
  if (!isRecord(value) || !hasBaseDocumentShape(value)) {
    return false;
  }
  if (
    'type' in value &&
    value['type'] !== undefined &&
    value['type'] !== 'standard'
  ) {
    return false;
  }
  if (
    value['contextLimit'] !== undefined ||
    value['policy'] !== undefined ||
    value['profiles'] !== undefined
  ) {
    return false;
  }
  return true;
}

/**
 * Structural type guard for a load balancer profile document.
 */
export function isLoadBalancerProfileDocument(
  value: unknown,
): value is LoadBalancerProfileDocument {
  if (!isRecord(value) || !hasBaseDocumentShape(value)) {
    return false;
  }
  if (value['type'] !== 'loadbalancer') {
    return false;
  }
  if (value['policy'] !== 'roundrobin' && value['policy'] !== 'failover') {
    return false;
  }
  if (!Array.isArray(value['profiles']) || !value['profiles'].every(isString)) {
    return false;
  }
  const contextLimit = value['contextLimit'];
  if (
    contextLimit !== undefined &&
    (typeof contextLimit !== 'number' ||
      !Number.isFinite(contextLimit) ||
      contextLimit <= 0)
  ) {
    return false;
  }
  return true;
}
