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

export interface CredentialResolutionDiagnostics {
  readonly provider: string;
  readonly profile: string;
  readonly runtimeId: string;
  readonly attemptedMechanisms: readonly CredentialMechanism[];
  readonly proxyMode: boolean;
  readonly proxyContacted: boolean;
}

export interface CredentialResolutionErrorOptions {
  readonly cause?: unknown;
  readonly remediation?: string;
}

export type CredentialResolutionResult =
  | { readonly token: string }
  | {
      readonly token: null;
      readonly failure: CredentialResolutionError;
    };

function buildMessage(
  kind: CredentialResolutionErrorKind,
  diagnostics: CredentialResolutionDiagnostics,
  remediation?: string,
): string {
  const diagnosticMessage =
    `Credential resolution failed: kind=${kind}; ` +
    `provider=${diagnostics.provider}; profile=${diagnostics.profile}; ` +
    `runtimeId=${diagnostics.runtimeId}; ` +
    `attemptedMechanisms=[${diagnostics.attemptedMechanisms.join(', ')}]; ` +
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
    super(
      buildMessage(kind, diagnostics, options.remediation),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'CredentialResolutionError';
    this.kind = kind;
    this.remediation = options.remediation;
    this.diagnostics = Object.freeze({
      ...diagnostics,
      attemptedMechanisms: Object.freeze([...diagnostics.attemptedMechanisms]),
    });
  }
}
