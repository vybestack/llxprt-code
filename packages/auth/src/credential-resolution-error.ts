/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type CredentialResolutionErrorKind =
  | 'no-credential-configured'
  | 'credential-not-found'
  | 'credential-source-failed'
  | 'proxy-unavailable'
  | 'proxy-unauthorized';

export type CredentialMechanism =
  | 'provider-auth-key'
  | 'provider-auth-keyfile'
  | 'constructor-api-key'
  | 'global-auth-key'
  | 'global-auth-key-name'
  | 'global-auth-keyfile'
  | `env:${string}`
  | 'oauth';

export type CredentialMechanismAttempts =
  | readonly CredentialMechanism[]
  | 'unknown';
export type ProxyContactState = boolean | 'unknown';

export interface CredentialResolutionDiagnostics {
  readonly provider: string;
  readonly profile: string;
  readonly runtimeId: string;
  readonly attemptedMechanisms: CredentialMechanismAttempts;
  readonly proxyMode: boolean;
  readonly proxyContacted: ProxyContactState;
}

export interface CredentialResolutionErrorOptions {
  readonly cause?: unknown;
  readonly remediation?: string;
}

/**
 * A resolved bearer. `accountId` is the minimal account identity that belongs
 * to `token` (never a refresh or ID token); it is present only when the
 * credential source resolved both from the same stored credential.
 * `identity: 'absent'` records that the source read the FULL stored credential
 * and it has no account identity, which is different from a bearer-only source
 * that never carried one. It holds no credential material.
 */
export interface ResolvedBearer {
  readonly token: string;
  readonly accountId?: string;
  readonly identity?: 'absent';
}

export type CredentialResolutionResult =
  | ResolvedBearer
  | {
      readonly token: null;
      readonly failure: CredentialResolutionError;
    };

function formatAttemptedMechanisms(
  attemptedMechanisms: CredentialMechanismAttempts,
): string {
  return attemptedMechanisms === 'unknown'
    ? 'unknown'
    : `[${attemptedMechanisms.join(', ')}]`;
}

function buildMessage(
  kind: CredentialResolutionErrorKind,
  diagnostics: CredentialResolutionDiagnostics,
  remediation?: string,
): string {
  const diagnosticMessage =
    `Credential resolution failed: kind=${kind}; ` +
    `provider=${diagnostics.provider}; profile=${diagnostics.profile}; ` +
    `runtimeId=${diagnostics.runtimeId}; ` +
    `attemptedMechanisms=${formatAttemptedMechanisms(diagnostics.attemptedMechanisms)}; ` +
    `proxyMode=${diagnostics.proxyMode}; ` +
    `proxyContacted=${diagnostics.proxyContacted}`;
  return remediation === undefined
    ? diagnosticMessage
    : `${remediation} ${diagnosticMessage}`;
}

export class CredentialResolutionError extends Error {
  readonly kind: CredentialResolutionErrorKind;
  readonly diagnostics: CredentialResolutionDiagnostics;
  readonly remediation: string | undefined;

  constructor(
    kind: CredentialResolutionErrorKind,
    diagnostics: CredentialResolutionDiagnostics,
    options: CredentialResolutionErrorOptions = {},
  ) {
    const trimmedRemediation = options.remediation?.trim();
    const remediation =
      trimmedRemediation === '' ? undefined : trimmedRemediation;
    super(
      buildMessage(kind, diagnostics, remediation),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'CredentialResolutionError';
    this.kind = kind;
    this.remediation = remediation;
    const attemptedMechanisms: CredentialMechanismAttempts =
      diagnostics.attemptedMechanisms === 'unknown'
        ? 'unknown'
        : Object.freeze([...diagnostics.attemptedMechanisms]);
    this.diagnostics = Object.freeze({
      ...diagnostics,
      attemptedMechanisms,
    });
  }
}
