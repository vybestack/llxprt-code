/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Environment credential variables CI injects into test steps. Tests that
 * exercise OAuth-based authentication must hold these back for their duration:
 * an ambient environment key outranks OAuth in AuthPrecedenceResolver, so the
 * mocked OAuth token would be shadowed by the inherited key (seen in CI as
 * masked "***" received values). Call `saveProviderEnvCredentials` before the
 * test, `clearProviderEnvCredentials` after, and
 * `restoreProviderEnvCredentials` in cleanup so parallel files never observe
 * another file's mutations.
 */
export const PROVIDER_ENV_CREDENTIAL_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
] as const;

export type ProviderEnvCredentialKey =
  (typeof PROVIDER_ENV_CREDENTIAL_KEYS)[number];

export type ProviderEnvCredentialsSnapshot = {
  readonly values: Readonly<
    Record<ProviderEnvCredentialKey, string | undefined>
  >;
};

export function saveProviderEnvCredentials(): ProviderEnvCredentialsSnapshot {
  const values = {} as Record<ProviderEnvCredentialKey, string | undefined>;
  for (const key of PROVIDER_ENV_CREDENTIAL_KEYS) {
    values[key] = process.env[key];
  }
  return { values };
}

export function clearProviderEnvCredentials(): void {
  for (const key of PROVIDER_ENV_CREDENTIAL_KEYS) {
    delete process.env[key];
  }
}

export function restoreProviderEnvCredentials(
  snapshot: ProviderEnvCredentialsSnapshot,
): void {
  for (const key of PROVIDER_ENV_CREDENTIAL_KEYS) {
    const value = snapshot.values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
