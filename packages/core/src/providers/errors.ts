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
  /**
   * Call-site provider identifier (e.g. `BaseProvider.openai`).
   */
  readonly providerKey: string;
  /**
   * Required runtime properties that were not supplied.
   */
  readonly missingFields: readonly string[];
  /**
   * Requirement tag to aid verification harnesses.
   */
  readonly requirement: string;
  /**
   * Recommendations for callers to remediate the guard failure.
   */
  readonly remediation: readonly string[];
  /**
   * Structured metadata attached to the error for diagnostics.
   */
  readonly context: {
    stage?: string;
    metadata?: Record<string, unknown>;
  };

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement:REQ-SP4-001
   * @pseudocode base-provider-fallback-removal.md lines 11-12
   */
  constructor({
    providerKey,
    missingFields,
    requirement = 'REQ-SP4-001',
    remediation,
    stage,
    metadata,
    message,
  }: {
    providerKey: string;
    missingFields: string[];
    requirement?: string;
    remediation?: string[];
    stage?: string;
    metadata?: Record<string, unknown>;
    message?: string;
  }) {
    const formattedMissing =
      missingFields.length > 0 ? missingFields.join(', ') : 'runtime data';
    super(
      message ??
        `Provider ${providerKey} invoked without required runtime context (${formattedMissing}).`,
    );
    this.name = 'MissingProviderRuntimeError';
    this.providerKey = providerKey;
    this.missingFields = missingFields;
    this.requirement = requirement;
    this.remediation = remediation ?? [
      'Ensure ProviderManager injects settings/config before invoking providers.',
      'Verify CLI runtime wiring activates an isolated ProviderRuntimeContext per call.',
    ];
    this.context = {
      stage,
      metadata,
    };
  }
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-002
 * @pseudocode provider-runtime-handling.md lines 11-12
 */
export class ProviderRuntimeNormalizationError extends Error {
  readonly providerKey: string;
  readonly requirement: string;
  readonly context: {
    runtimeId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  };

  constructor({
    providerKey,
    message,
    requirement = 'REQ-SP4-002',
    runtimeId,
    stage,
    metadata,
  }: {
    providerKey: string;
    message: string;
    requirement?: string;
    runtimeId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  }) {
    super(message);
    this.name = 'ProviderRuntimeNormalizationError';
    this.providerKey = providerKey;
    this.requirement = requirement;
    this.context = {
      runtimeId,
      stage,
      metadata,
    };
  }
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-004
 * @pseudocode logging-wrapper-adjustments.md lines 11, 15
 */
export class ProviderRuntimeScopeError extends Error {
  readonly requirement: string;
  readonly context: {
    callId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  };

  constructor({
    message,
    requirement = 'REQ-SP4-004',
    callId,
    stage,
    metadata,
  }: {
    message: string;
    requirement?: string;
    callId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  }) {
    super(message);
    this.name = 'ProviderRuntimeScopeError';
    this.requirement = requirement;
    this.context = {
      callId,
      stage,
      metadata,
    };
  }
}

/**
 * Error thrown when all backends in a load balancer failover policy have failed
 * @plan PLAN-20251212issue488
 */
export class LoadBalancerFailoverError extends Error {
  readonly profileName: string;
  readonly failures: ReadonlyArray<{
    readonly profile: string;
    readonly error: Error;
  }>;

  constructor(
    profileName: string,
    failures: Array<{ profile: string; error: Error }>,
  ) {
    const profileNames = failures.map((f) => f.profile).join(', ');
    const errorSummary =
      failures.length === 1
        ? failures[0].error.message
        : `${failures.length} backends failed`;
    super(
      `Load balancer "${profileName}" failover exhausted: ${errorSummary} (tried: ${profileNames})`,
    );
    this.name = 'LoadBalancerFailoverError';
    this.profileName = profileName;
    this.failures = failures;
  }
}
