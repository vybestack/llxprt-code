/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CredentialResolutionError,
  type CredentialResolutionErrorKind,
} from '@vybestack/llxprt-code-auth';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

interface CredentialFailureFallback {
  readonly kind: CredentialResolutionErrorKind;
  readonly cause?: unknown;
  readonly remediation?: string;
}

function resolveProfile(options: NormalizedGenerateChatOptions): string {
  const profile = options.settings.get('currentProfile');
  return typeof profile === 'string' && profile.trim() !== ''
    ? profile
    : 'no-profile';
}

/**
 * Builds a provider-facing credential failure. A fallback with an explicit
 * `cause` represents a failure that happened after resolution, so its kind and
 * cause take precedence while the resolver diagnostics remain authoritative.
 * Without a live cause, the resolver's original classification is preserved.
 */
export function createCredentialResolutionError(
  options: NormalizedGenerateChatOptions,
  provider: string,
  fallback: CredentialFailureFallback = {
    kind: 'no-credential-configured',
  },
): CredentialResolutionError {
  if (options.resolved.authFailure !== undefined) {
    const failure = options.resolved.authFailure;
    const hasLiveCause = Object.prototype.hasOwnProperty.call(
      fallback,
      'cause',
    );
    if (!hasLiveCause && fallback.remediation === undefined) return failure;
    const remediation = fallback.remediation ?? failure.remediation;
    const cause = hasLiveCause ? fallback.cause : failure.cause;
    return new CredentialResolutionError(
      hasLiveCause ? fallback.kind : failure.kind,
      failure.diagnostics,
      {
        ...(cause === undefined ? {} : { cause }),
        ...(remediation === undefined ? {} : { remediation }),
      },
    );
  }

  return new CredentialResolutionError(
    fallback.kind,
    {
      provider,
      profile: resolveProfile(options),
      runtimeId: options.runtime?.runtimeId ?? 'no-runtime',
      attemptedMechanisms: 'unknown',
      proxyMode: Boolean(process.env.LLXPRT_CREDENTIAL_SOCKET),
      proxyContacted: 'unknown',
    },
    {
      ...(fallback.cause === undefined ? {} : { cause: fallback.cause }),
      ...(fallback.remediation === undefined
        ? {}
        : { remediation: fallback.remediation }),
    },
  );
}
