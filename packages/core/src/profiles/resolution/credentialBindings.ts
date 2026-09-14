/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CredentialBinding } from '../ports/credentialResolverPort.js';
import type { StandardProfileDocument } from '../contracts/profileDocument.js';

export type CredentialBindingOutcome = {
  bindings: readonly CredentialBinding[];
  warnings: readonly string[];
};

/**
 * Derive credential bindings from a standard profile document.
 *
 * The first explicit intent wins: OAuth auth config, an auth-key-name setting, an
 * auth-keyfile path, or a present auth-key. An inline auth-key is only a warning
 * because the key itself is secret material and is never copied into a binding. Without
 * explicit intent the provider itself is the binding; an empty provider means no binding
 * at all. Bindings carry references only, never secrets.
 */
export function deriveCredentialBindings(
  document: StandardProfileDocument,
): CredentialBindingOutcome {
  if (document.auth?.type === 'oauth') {
    return {
      bindings: [
        {
          kind: 'oauth',
          provider: document.provider,
          buckets: document.auth.buckets ?? [],
        },
      ],
      warnings: [],
    };
  }
  const keyName = document.ephemeralSettings['auth-key-name'];
  if (typeof keyName === 'string') {
    return {
      bindings: [{ kind: 'key-name', keyName }],
      warnings: [],
    };
  }
  const keyfile = document.ephemeralSettings['auth-keyfile'];
  if (typeof keyfile === 'string') {
    return {
      bindings: [{ kind: 'keyfile', path: keyfile }],
      warnings: [],
    };
  }
  if (document.ephemeralSettings['auth-key'] !== undefined) {
    return {
      bindings: [],
      warnings: ['inline auth-key present; prefer auth-key-name for rotation'],
    };
  }
  if (document.provider !== '') {
    return {
      bindings: [{ kind: 'provider-default', provider: document.provider }],
      warnings: [],
    };
  }
  return { bindings: [], warnings: [] };
}
