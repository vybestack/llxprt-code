/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned runtime error for missing provider context.
 *
 * This error is owned by core runtime, NOT by the providers package.
 * When providerRuntimeContext.ts needs a missing-provider error, it imports
 * from this core-owned location instead of the providers package.
 *
 * Provider-specific errors (AuthError, RateLimitError, etc.) remain in
 * the providers package.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-04, lines 40-44
 */

/**
 * Error thrown when a provider is invoked without required runtime context.
 *
 * This is the core-owned equivalent of the provider package's
 * MissingProviderRuntimeError, ensuring core runtime can throw
 * context-missing errors without importing from providers.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export class MissingRuntimeProviderError extends Error {
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

  constructor({
    providerKey,
    missingFields,
    requirement = 'REQ-DEP-001',
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
    this.name = 'MissingRuntimeProviderError';
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
