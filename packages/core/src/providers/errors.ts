/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error thrown when authentication is required but not available
 */
export class AuthenticationRequiredError extends Error {
  readonly authMode: string;
  readonly requiredAuth?: string[];

  constructor(message: string, authMode: string, requiredAuth?: string[]) {
    super(message);
    this.name = 'AuthenticationRequiredError';
    this.authMode = authMode;
    this.requiredAuth = requiredAuth;
  }
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P03
 * @requirement:REQ-SP4-001
 * @pseudocode base-provider-runtime-guard.md lines 10-14
 */
export class MissingProviderRuntimeError extends Error {
  constructor(message = 'Provider runtime context is missing.') {
    super(message);
    this.name = 'MissingProviderRuntimeError';
  }
}
