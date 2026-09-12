/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reference to a credential, never the secret itself.
 *
 * Bindings hold references only: key names, keyfile paths, or OAuth provider and
 * bucket ids. Resolvers turn a binding into a short-lived secret at use time so key
 * rotation is picked up on the next resolve; resolved tokens are never cached in profile
 * state.
 */
export type CredentialBinding =
  | { kind: 'key-name'; keyName: string }
  | { kind: 'keyfile'; path: string }
  | { kind: 'oauth'; provider: string; buckets: readonly string[] }
  | { kind: 'provider-default'; provider: string };

/**
 * Outcome of resolving a {@link CredentialBinding}.
 */
export type CredentialSecret =
  | { kind: 'resolved'; token: string }
  | { kind: 'unavailable'; reason: string };

/**
 * Resolves credential references into use-time secrets.
 *
 * Implementations own the actual secret store (settings keychain, auth buckets). The
 * resolver surface is deliberately an interface: the profiles tree names what it needs and
 * never holds secret material.
 */
export interface CredentialResolverPort {
  resolve(binding: CredentialBinding): Promise<CredentialSecret>;
}
