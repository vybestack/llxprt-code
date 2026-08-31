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

export function createCredentialResolutionError(
  options: NormalizedGenerateChatOptions,
  provider: string,
  fallback: CredentialFailureFallback = {
    kind: 'no-credential-configured',
  },
): CredentialResolutionError {
  if (options.resolved.authFailure !== undefined) {
    const failure = options.resolved.authFailure;
    return fallback.remediation === undefined
      ? failure
      : new CredentialResolutionError(failure.kind, failure.diagnostics, {
          ...(failure.cause === undefined ? {} : { cause: failure.cause }),
          remediation: fallback.remediation,
        });
  }

  return new CredentialResolutionError(
    fallback.kind,
    {
      provider,
      profile: resolveProfile(options),
      runtimeId: options.runtime?.runtimeId ?? 'no-runtime',
      attemptedMechanisms: [],
      proxyMode: Boolean(process.env.LLXPRT_CREDENTIAL_SOCKET),
      proxyContacted: false,
    },
    {
      ...(fallback.cause === undefined ? {} : { cause: fallback.cause }),
      ...(fallback.remediation === undefined
        ? {}
        : { remediation: fallback.remediation }),
    },
  );
}
